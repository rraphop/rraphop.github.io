/* 소개글은 일반 텍스트, ## 소제목, ![설명](HTTPS 이미지 주소)만 지원합니다. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  function httpsUrl(value, download = false) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port) return "";
      if (download && !["github.com", "raw.githubusercontent.com"].includes(url.hostname)) return "";
      return url.href;
    } catch { return ""; }
  }
  function bodyHtml(body) {
    return String(body || "").split(/\r?\n/).map((line) => {
      const image = line.match(/^!\[([^\]\n]*)\]\((https:\/\/[^\s]+)\)$/);
      if (image && httpsUrl(image[2])) {
        return `<figure><img src="${escape(httpsUrl(image[2]))}" alt="${escape(image[1])}" loading="lazy" referrerpolicy="no-referrer"><figcaption>${escape(image[1])}</figcaption></figure>`;
      }
      if (line.startsWith("## ")) return `<h3>${escape(line.slice(3))}</h3>`;
      return line ? `<p>${escape(line)}</p>` : "<br>";
    }).join("");
  }
  window.PROGRAM_RENDER = Object.freeze({ bodyHtml, httpsUrl });
  if (!$('programList')) return;
  let programs = [], active = null, comments = [], page = 1, requestVersion = 0, deleteTarget = null;
  const pageSize = 8;
  const form = $('programForm');
  const commentForm = $('programCommentForm');
  const deleteForm = $('programDeleteForm');
  const api = (action, params = {}) => window.DATA_API.request(action, params);
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleDateString("ko-KR");
  };
  function message(id, text = "", error = false) {
    $(id).textContent = text;
    $(id).classList.toggle('is-error', error);
  }
  function focusPanel(id) {
    $(id).scrollIntoView({ behavior: 'smooth', block: 'start' });
    const target = $(id).querySelector('input:not([type="hidden"]), button') || $(id);
    target.focus({ preventScroll: true });
  }
  function lockForm(target, disabled) {
    target.querySelectorAll('input, select, textarea, button').forEach((control) => { control.disabled = disabled; });
  }
  function display(view) {
    $('programListSection').hidden = view !== 'list';
    $('programDetail').hidden = view !== 'detail';
    $('programFeedback').hidden = view !== 'detail';
    $('programEditor').hidden = view !== 'editor';
  }
  function setHash(id) {
    history.pushState(null, '', id ? `#${encodeURIComponent(id)}` : location.pathname + location.search);
  }
  function selectedId() {
    try { return decodeURIComponent(location.hash.slice(1)); } catch { return ''; }
  }
  function renderList() {
    const query = $('programSearch').value.trim().toLocaleLowerCase();
    const category = $('programCategory').value;
    const filtered = programs.filter((item) => (!category || item.category === category) && `${item.title} ${item.summary}`.toLocaleLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages);
    $('programCount').textContent = `프로그램 ${filtered.length}개`;
    $('programList').innerHTML = filtered.length ? filtered.slice((page - 1) * pageSize, page * pageSize).map((item) => `
      <article class="program-card">
        <span class="program-badge">${escape(item.category)}</span>
        <h2><a href="#${encodeURIComponent(item.id)}">${escape(item.title)}</a></h2>
        <p class="program-muted">${escape(item.summary)}</p>
        <p class="program-meta">${escape(item.version ? `v${item.version} · ` : '')}${escape(item.windows || 'Windows')}<br>업데이트 ${escape(date(item.updatedAt))}</p>
        <a href="#${encodeURIComponent(item.id)}" class="button secondary">소개 및 다운로드 →</a>
      </article>`).join('') : `<div class="program-empty"><h2>${programs.length ? '검색 결과가 없습니다.' : '아직 등록된 프로그램이 없습니다.'}</h2><p>${programs.length ? '다른 검색어나 분류를 선택해 주세요.' : '새로운 프로그램이 등록되면 이곳에서 만나볼 수 있습니다.'}</p></div>`;
    const nav = $('programPagination');
    nav.replaceChildren();
    if (pages > 1) {
      for (let i = 1; i <= pages; i++) {
        const button = document.createElement('button');
        button.className = 'button secondary small';
        button.textContent = String(i);
        button.type = 'button';
        button.setAttribute('aria-label', `${i}페이지`);
        if (i === page) button.setAttribute('aria-current', 'page');
        button.onclick = () => { page = i; renderList(); };
        nav.append(button);
      }
    }
  }
  async function loadList() {
    $('retryPrograms').hidden = true;
    const payload = await api('programList');
    programs = payload.programs;
    renderList();
  }
  function renderImages(container) {
    container.querySelectorAll('img').forEach((img) => {
      img.addEventListener('error', () => {
        const notice = document.createElement('p');
        notice.className = 'image-error';
        notice.textContent = '이미지를 불러오지 못했습니다. 이미지 주소와 공개 설정을 확인하세요.';
        img.replaceWith(notice);
      }, { once: true });
    });
  }
  function renderDetail() {
    const url = httpsUrl(active.downloadUrl, true);
    $('programDetail').innerHTML = `
      <div class="program-toolbar"><button type="button" class="button secondary" data-action="back">← 목록</button><div class="program-actions"><button type="button" class="button secondary small" data-action="edit">관리자 수정</button><button type="button" class="button secondary small" data-action="delete">삭제</button></div></div>
      <span class="program-badge">${escape(active.category)}</span>
      <h2 class="program-detail-title">${escape(active.title)}</h2>
      <p class="program-muted">${escape(active.summary)}</p>
      <p class="program-meta">등록 ${escape(date(active.createdAt))} · 업데이트 ${escape(date(active.updatedAt))}</p>
      <div class="program-download"><p>${escape(active.version ? `버전 ${active.version} · ` : '')}${escape(active.windows || 'Windows용 프로그램')}</p>${url ? `<a class="button primary" href="${escape(url)}" target="_blank" rel="noopener noreferrer">프로그램 다운로드 ↗</a>` : '<p>다운로드 주소를 확인해 주세요.</p>'}</div>
      <div class="program-body">${bodyHtml(active.body)}</div>`;
    renderImages($('programDetail'));
    renderComments();
  }
  function renderComments() {
    $('feedbackTitle').textContent = `댓글과 피드백 ${comments.length}`;
    $('programComments').innerHTML = comments.length ? comments.map((item) => `
      <article class="program-comment"><strong>${escape(item.name)}</strong> ${item.admin ? '<span class="program-badge">관리자</span>' : ''}
        <span class="program-meta">${escape(date(item.createdAt))}${item.updatedAt !== item.createdAt ? ' · 수정됨' : ''}</span>
        <p>${escape(item.text)}</p>
        <div class="program-actions"><button type="button" class="button secondary small" data-comment-edit="${escape(item.id)}">수정</button><button type="button" class="button secondary small" data-comment-delete="${escape(item.id)}">삭제</button></div>
      </article>`).join('') : '<p class="program-muted">첫 번째 사용 후기를 남겨 주세요.</p>';
  }
  function resetComment() {
    commentForm.reset();
    commentForm.elements.id.value = '';
    $('commentFormTitle').textContent = '댓글 남기기';
    $('cancelCommentEdit').hidden = true;
    $('commentPasswordLabel').textContent = '댓글 비밀번호';
    message('commentMessage');
  }
  async function route() {
    const version = ++requestVersion;
    form.elements.adminPassword.value = '';
    resetComment();
    message('programStatus');
    const id = selectedId();
    if (!id) { active = null; display('list'); return; }
    active = null;
    display('detail');
    $('programDetail').textContent = '프로그램을 불러오는 중입니다…';
    $('programFeedback').hidden = true;
    try {
      const payload = await api('programDetail', { id });
      if (version !== requestVersion) return;
      active = payload.program;
      comments = payload.comments;
      renderDetail();
      display('detail');
    } catch (error) {
      if (version !== requestVersion) return;
      display('list');
      message('programStatus', `게시글을 불러오지 못했습니다. ${error.message}`, true);
      $('retryPrograms').hidden = false;
    }
  }
  function editProgram(item) {
    ++requestVersion;
    form.reset();
    form.elements.id.value = '';
    ['id', 'title', 'category', 'version', 'windows', 'summary', 'body', 'downloadUrl'].forEach((key) => {
      if (item) form.elements[key].value = item[key] || '';
    });
    $('editorTitle').textContent = item ? '프로그램 수정' : '프로그램 등록';
    $('programPreview').open = false;
    message('editorMessage');
    message('programStatus');
    display('editor');
    focusPanel('programEditor');
  }
  $('newProgram').onclick = () => editProgram(null);
  $('closeEditor').onclick = () => {
    if (form.elements.body.value && !confirm('작성을 취소할까요? 저장하지 않은 내용은 사라집니다.')) return;
    form.reset();
    route();
  };
  $('programCategory').onchange = $('programSearch').oninput = () => { page = 1; renderList(); };
  $('programDetail').onclick = (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'back') { setHash(''); route(); }
    if (action === 'edit') editProgram(active);
    if (action === 'delete') openDelete('program', active.id);
  };
  $('insertProgramImage').onclick = () => {
    const url = httpsUrl($('programImageUrl').value.trim());
    if (!url) { message('editorMessage', '공개된 이미지의 HTTPS 주소를 입력하세요.', true); return; }
    const description = $('programImageAlt').value.replace(/[\[\]\r\n]/g, ' ').trim();
    const body = $('programBody');
    const insertion = `\n![${description}](${url})\n`;
    if (body.value.length + insertion.length > 20000) { message('editorMessage', '소개 내용은 20,000자 이내로 입력하세요.', true); return; }
    body.setRangeText(insertion, body.selectionStart, body.selectionEnd, 'end');
    body.focus();
    $('programImageUrl').value = '';
    $('programImageAlt').value = '';
    message('editorMessage', '그림을 삽입했습니다. 미리보기에서 확인하세요.');
    preview();
  };
  function preview() {
    $('programPreviewBody').innerHTML = bodyHtml(form.elements.body.value);
    renderImages($('programPreviewBody'));
  }
  $('programPreview').ontoggle = () => { if ($('programPreview').open) preview(); };
  $('programBody').oninput = () => { if ($('programPreview').open) preview(); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const params = Object.fromEntries(new FormData(form));
    if (!httpsUrl(params.downloadUrl, true)) { message('editorMessage', 'GitHub의 HTTPS 다운로드 주소를 입력하세요.', true); return; }
    lockForm(form, true);
    $('closeEditor').disabled = true;
    message('editorMessage', '저장 중입니다…');
    try {
      const payload = await api('programSave', params);
      form.reset();
      if (active?.id !== payload.program.id) comments = [];
      active = payload.program;
      setHash(active.id);
      resetComment();
      renderDetail();
      display('detail');
      focusPanel('programDetail');
      message('programStatus', '게시글을 저장했습니다.');
      try { await loadList(); } catch { message('programStatus', '게시글을 저장했습니다. 목록 갱신은 새로고침 후 확인해 주세요.'); }
    } catch (error) { message('editorMessage', error.message, true); }
    finally { lockForm(form, false); $('closeEditor').disabled = false; }
  };
  commentForm.elements.asAdmin.onchange = () => {
    $('commentPasswordLabel').textContent = commentForm.elements.asAdmin.checked ? '관리자 비밀번호' : '댓글 비밀번호';
    commentForm.elements.password.value = '';
  };
  $('cancelCommentEdit').onclick = resetComment;
  $('programComments').onclick = (event) => {
    const editId = event.target.closest('[data-comment-edit]')?.dataset.commentEdit;
    const deleteId = event.target.closest('[data-comment-delete]')?.dataset.commentDelete;
    if (deleteId) openDelete('comment', deleteId);
    if (!editId) return;
    const item = comments.find((comment) => comment.id === editId);
    resetComment();
    commentForm.elements.id.value = item.id;
    commentForm.elements.name.value = item.name;
    commentForm.elements.text.value = item.text;
    commentForm.elements.asAdmin.checked = item.admin;
    $('commentPasswordLabel').textContent = item.admin ? '관리자 비밀번호' : '댓글 비밀번호';
    $('commentFormTitle').textContent = '댓글 수정';
    $('cancelCommentEdit').hidden = false;
    commentForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    commentForm.elements.password.focus({ preventScroll: true });
  };
  commentForm.onsubmit = async (event) => {
    event.preventDefault();
    if (!active) return;
    const params = Object.fromEntries(new FormData(commentForm));
    params.programId = active.id;
    if (params.asAdmin) { params.adminPassword = params.password; delete params.password; }
    delete params.asAdmin;
    lockForm(commentForm, true);
    message('commentMessage', '댓글을 저장하는 중입니다…');
    try {
      const payload = await api('programCommentSave', params);
      if (active?.id !== params.programId) return;
      const index = comments.findIndex((item) => item.id === payload.comment.id);
      if (index >= 0) comments[index] = payload.comment;
      else comments.push(payload.comment);
      renderComments();
      resetComment();
      message('commentMessage', '댓글을 저장했습니다.');
    } catch (error) { message('commentMessage', error.message, true); }
    finally { lockForm(commentForm, false); }
  };
  function openDelete(type, id) {
    deleteTarget = { type, id, programId: active.id };
    deleteForm.reset();
    $('deleteTitle').textContent = type === 'program' ? '게시글 삭제' : '댓글 삭제';
    $('deleteDescription').textContent = type === 'program' ? '게시글과 모든 댓글을 삭제합니다. GitHub에 올린 원본 파일은 유지됩니다.' : '댓글을 삭제합니다. 이 작업은 되돌릴 수 없습니다.';
    $('deleteAdminOption').hidden = type === 'program';
    deleteForm.elements.asAdmin.checked = type === 'program' || Boolean(comments.find((item) => item.id === id)?.admin);
    updateDeleteLabel();
    message('deleteMessage');
    $('programDeleteDialog').showModal();
  }
  function updateDeleteLabel() {
    $('deletePasswordLabel').textContent = deleteForm.elements.asAdmin.checked ? '관리자 비밀번호' : '댓글 비밀번호';
    deleteForm.elements.password.value = '';
  }
  deleteForm.elements.asAdmin.onchange = updateDeleteLabel;
  $('cancelDelete').onclick = () => $('programDeleteDialog').close();
  $('programDeleteDialog').addEventListener('close', () => deleteForm.reset());
  deleteForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = { ...deleteTarget };
    const params = { id: target.id };
    params[deleteForm.elements.asAdmin.checked ? 'adminPassword' : 'password'] = deleteForm.elements.password.value;
    lockForm(deleteForm, true);
    message('deleteMessage', '삭제 중입니다…');
    try {
      await api(target.type === 'program' ? 'programDelete' : 'programCommentDelete', params);
      $('programDeleteDialog').close();
      if (target.type === 'program') {
        programs = programs.filter((item) => item.id !== target.id);
        renderList();
        setHash('');
        route();
        message('programStatus', '게시글을 삭제했습니다.');
      } else if (active?.id === target.programId) {
        comments = comments.filter((item) => item.id !== target.id);
        renderComments();
        resetComment();
        message('commentMessage', '댓글을 삭제했습니다.');
      }
    } catch (error) { message('deleteMessage', error.message, true); }
    finally { lockForm(deleteForm, false); }
  };
  async function initialize() {
    const version = requestVersion;
    message('programStatus', '자료실을 불러오는 중입니다…');
    try {
      await loadList();
      message('programStatus');
      if (version === requestVersion) await route();
    } catch (error) {
      message('programStatus', `자료실을 불러오지 못했습니다. ${error.message}`, true);
      $('programList').innerHTML = '<div class="program-empty"><h2>자료실 연결을 확인해 주세요.</h2><p>잠시 후 다시 불러와 주세요. 관리자는 자료실 기능이 포함된 Apps Script 배포 버전을 확인해 주세요.</p></div>';
      $('retryPrograms').hidden = false;
    }
  }
  $('retryPrograms').onclick = initialize;
  window.addEventListener('hashchange', route);
  initialize();
})();
