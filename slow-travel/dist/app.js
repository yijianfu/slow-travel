'use strict';
const main = document.getElementById('main');
const topbar = document.getElementById('topbar');
const modal = document.getElementById('editor');
const notice = document.getElementById('notice');
const shareToken = location.pathname.match(/^\/s\/([^/]+)\/?$/)?.[1] || '';
const readonly = Boolean(shareToken);
const statusNames = { planned: '计划中', ongoing: '旅途中', completed: '已归来' };
const choiceNames = { candidate: '候选', wanted: '想去', maybe: '待定' };
const extraPhotos = new WeakMap();
let book = null;
let etag = '';
let busy = false;
let activeTab = readonly ? 'journal' : 'plan';
let cityFilter = '';
let placeFilter = 'all';
let categoryFilter = '';
let showAllPlaces = false;
let noticeTimer;
let selectedTripId = '';
let actionFocus = null;

const icons = {
  arrow: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  back: '<path d="M20 12H5m5-5-5 5 5 5"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  book: '<path d="M4 4h13a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2Zm0 13h15M8 4v12"/>',
  map: '<path d="m3 5 6-2 6 2 6-2v15l-6 3-6-3-6 2Zm6-2v15m6-13v16"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4Zm10-10 4 4"/>',
  share: '<path d="M12 15V3m-4 4 4-4 4 4M6 11H4v10h16V11h-2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  folder: '<path d="M3 7V4h6l2 3h10v13H3Z"/>',
  pages: '<path d="M3 4h6c2 0 3 1 3 2 0-1 1-2 3-2h6v15h-6c-2 0-3 1-3 2 0-1-1-2-3-2H3Zm9 2v15"/>',
  ink: '<path d="m4 20 3-7L17 3l4 4-10 10Zm3-7 4 4m-7 3 3-3"/>',
  photo: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m4 18 5-5 4 4 3-4 4 5"/>',
  leaf: '<path d="M19 3C6 3 3 10 6 16c6 4 14 0 13-13ZM4 21l10-12"/>',
  archive: '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v12h14V8m-10 4h6"/>',
  check: '<path d="m4 12 5 5L20 6"/>',
  link: '<path d="M10 8l3-3a5 5 0 0 1 7 7l-3 3m-3 1-3 3a5 5 0 0 1-7-7l3-3m1 7 8-8"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  trash: '<path d="M3 6h18m-14 0 1 15h8l1-15m-8 0V3h6v3"/>'
};

function icon(name, size = 17) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[ch]));
}
function externalUrl(input) {
  try {
    const url = new URL(input);
    return ['https:', 'http:'].includes(url.protocol) ? esc(url.href) : '';
  } catch { return ''; }
}
function photoUrl(input) {
  try {
    const url = new URL(input, location.origin);
    return url.origin === location.origin && url.pathname.startsWith('/api/') ? esc(url.pathname + url.search) : '';
  } catch { return ''; }
}
function tripLink(id) { return '#/trips/' + encodeURIComponent(id); }
function dayLabel(day) { return `第 ${day} 天`; }
function totalDays(trip) { return trip.days ? `${trip.days} 天` : '天数待定'; }
function dates(trip) { return trip.startDate || '日期待定'; }
function volume(trip) { return String(book.trips.indexOf(trip) + 1).padStart(2, '0'); }
function currentTrip() { return book?.trips.find(trip => trip.id === selectedTripId); }
function badge(trip) { return `<span class="badge ${esc(trip.status)}"><i></i>${esc(statusNames[trip.status] || trip.status)}</span>`; }
function button(action, label, name = '', css = 'button', attrs = '') {
  return `<button type="button" class="${css}" data-action="${action}" ${attrs}>${name ? icon(name) : ''}${label}</button>`;
}
function emptyBlock(heading, text, glyph) {
  return `<div class="empty-block">${icon(glyph, 27)}<div><strong>${heading}</strong><p>${text}</p></div></div>`;
}
function toast(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.classList.add('visible');
  noticeTimer = setTimeout(() => notice.classList.remove('visible'), 4300);
}
async function request(path, options = {}) {
  const response = await fetch(path, {cache:'no-store', ...options});
  if (!response.ok) {
    const msg = await response.json().catch(() => ({}));
    const error = new Error(response.status === 401 ? '登录后即可打开私人手账。' :
      [409,412,428].includes(response.status) ? '这本手账已在另一处更新。请先复制未保存的文字，再重新读取。' :
      typeof msg.error === 'string' ? msg.error : `操作未完成（${response.status}），请重试。`);
    error.status = response.status;
    throw error;
  }
  return response;
}
function responseRevision(response) {
  const revision = response.headers.get('X-Journal-Revision');
  if (/^[1-9]\d*$/.test(revision || '')) return '"' + revision + '"';
  return (response.headers.get('ETag') || '').replace(/^W\//, '');
}
async function loadBook() {
  const response = await request(readonly ? `/api/shared/${encodeURIComponent(shareToken)}` : '/api/book');
  const incoming = await response.json();
  if (!Array.isArray(incoming.trips)) throw new Error('手账数据无法读取，请重试。');
  etag = responseRevision(response);
  book = incoming;
}
async function saveChange(change) {
  if (readonly || !etag) throw new Error('请重新读取手账后再保存。');
  const draft = structuredClone(book);
  change(draft);
  const response = await request('/api/book', {
    method:'PUT', headers:{'Content-Type':'application/json','If-Match':etag}, body:JSON.stringify(draft)
  });
  etag = responseRevision(response);
  book = await response.json();
  if (!etag) await loadBook();
}
function masthead() {
  const brand = `<svg width="36" height="31" aria-hidden="true"><use href="#mark"/></svg><span>慢慢走</span>`;
  topbar.innerHTML = `<div class="bar"><a class="brand" href="${readonly ? esc(location.pathname) : '#/'}" aria-label="慢慢走，${readonly ? '共享手账' : '首页'}">${brand}</a>
    <span class="brand-caption">TRAVEL JOURNAL</span>
    ${readonly ? '<span class="private-label">只读手账</span></div>' : `<nav class="topnav" aria-label="主导航"><a href="#/shelf">${icon('book')}<span>旅行书架</span></a><a href="#/map">${icon('map')}<span>城市地图</span></a></nav>
    <span class="bar-divider"></span>${button('backup','<span>备份</span>','archive','icon-button backup','aria-label="导出或恢复备份"')}</div>`}`;
  document.getElementById('colophon').innerHTML = `<div><span class="footer-title">慢慢走</span><span class="footer-rule"></span><span>个人旅行手账</span></div><small>TRAVEL JOURNAL</small>`;
}
function heroArt(trip) {
  if (trip.city.includes('南京')) return `<div class="art"><svg viewBox="0 0 600 340" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><use href="#nanjing-cut"/></svg><img src="/assets/nanjing-cover.webp" alt="南京印象，原创封面插画" class="cover-image"><small>金陵印象　/　封面插画</small></div>`;
  return `<div class="art art-type"><span>${esc(trip.city)}</span><small>城市手账　/　VOL. ${volume(trip)}</small></div>`;
}
function home() {
  selectedTripId = '';
  const first = book.trips.at(-1);
  const cities = [...new Set(book.trips.map(trip => trip.city))];
  if (!cities.includes(cityFilter)) cityFilter = '';
  const shelf = book.trips.filter(trip => !cityFilter || trip.city === cityFilter).slice().reverse();
  const nj = book.trips.find(trip => trip.city.includes('南京'));
  const label = `<div class="eyebrow"><span class="small-rule"></span> 旅 行 手 账 <span class="mono"> / FIELD NOTES</span></div>`;
  main.innerHTML = `<div class="home">
    ${first ? `<section class="hero"><div class="hero-content">${label}
      <div class="volume">VOL. ${volume(first)} <span>／</span> ${badge(first)}</div>
      <h1>${esc(first.title)}</h1>
      <p class="hero-lead">${first.id === 'nanjing-first' ? '一直想去南京，于是为它留了一册。' : `${esc(first.city)}的出发计划与沿途记录。`}</p>
      <div class="hero-links"><a class="button primary" href="${tripLink(first.id)}">翻开手账 ${icon('arrow')}</a></div>
    </div>${heroArt(first)}</section>` : `<section class="intro-empty">${label}<h1>我的旅行手账</h1><p>为下一次出发留一册。</p>${button('create-trip','新建手账','plus','button primary')}</section>`}
    <div class="home-grid"><section class="shelf" id="shelf">
      <div class="section-title"><div class="eyebrow">MY COLLECTION</div><div class="section-line"><h2>旅行书架</h2>${button('create-trip','新建一册','plus','button small')}</div></div>
      ${cityFilter ? `<div class="filter-info">正在看 ${esc(cityFilter)} ${button('reset-city','查看全部','','link-button')}</div>` : ''}
      ${shelf.map(trip => `<a class="book-row" href="${tripLink(trip.id)}">
        <div class="book-mini"><small>VOL. ${volume(trip)}</small><b>${esc(trip.city)}</b><i></i></div>
        <div class="book-row-text">${badge(trip)}<h3>${esc(trip.title)}</h3><span class="meta">${esc(trip.city)} <i>·</i> ${esc(dates(trip))} <i>·</i> ${totalDays(trip)}</span></div>
        <span class="open-arrow">${icon('arrow',20)}</span></a>`).join('') || emptyBlock('书架还空着','从想去的第一个地方开始。','book')}
    </section><section class="map-panel" id="map">
      <div class="eyebrow">PLACES INDEX</div><div class="section-line"><h2>城市地图</h2><span class="quiet">${cities.length} 座城市</span></div>
      <div class="map-box"><img src="/assets/china-map.svg" width="648" height="440" alt="中国城市索引地图">
      ${nj ? `<button class="map-marker ${esc(nj.status)}" type="button" data-action="city" data-city="${esc(nj.city)}" aria-label="查看${esc(nj.city)}的手账"><i></i><span>${esc(nj.city)}</span></button>` : ''}</div>
      <div class="city-list">${cities.map(city => `<button class="city-link" data-action="city" data-city="${esc(city)}">${icon('pin',14)}${esc(city)} ${icon('arrow',14)}</button>`).join('')}</div>
    </section></div></div>`;
}
function sourceLinks(ids) {
  const sources = (book.sources || []).filter(source => ids?.includes(source.id));
  return sources.map(source => {
    const archive = externalUrl(source.archiveUrl), original = externalUrl(source.originalUrl);
    return `<p><span>${esc(source.title)}</span>${archive ? ` <a target="_blank" rel="noopener noreferrer" href="${archive}">公开存档 ↗</a>` : ''}${original ? ` <a target="_blank" rel="noopener noreferrer" href="${original}">原帖 ↗</a>` : ''}</p>`;
  }).join('');
}
function candidatePanel(trip) {
  const all = trip.candidates || [];
  const categories = [...new Set(all.map(place => place.category).filter(Boolean))];
  if (!categories.includes(categoryFilter)) categoryFilter = '';
  const places = all.filter(place => (placeFilter === 'all' || place.state === placeFilter) && (!categoryFilter || place.category === categoryFilter));
  const visible = showAllPlaces ? places : places.slice(0, 6);
  return `<section class="paper-section">
    <div class="section-line"><div><div class="eyebrow">PLACES TO GO</div><h2>想去的地方</h2></div>${button('add-place','添加地点','plus','button small')}</div>
    <div class="filters" aria-label="地点筛选">${[['all','全部'],['wanted','想去'],['maybe','待定'],['candidate','候选']].map(([id,text]) => `<button aria-pressed="${id === placeFilter}" data-action="filter" data-filter="${id}">${text} <span>${id === 'all' ? all.length : all.filter(p => p.state === id).length}</span></button>`).join('')}</div>
    ${categories.length ? `<label class="category-picker">按主题浏览 <select data-category><option value="">所有主题</option>${categories.map(name => `<option value="${esc(name)}" ${name === categoryFilter ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></label>` : ''}
    ${trip.id === 'nanjing-first' && trip.candidates.some(place => place.sourceIds?.length) ? '<p class="source-caption">地点参考自 2024 年的攻略存档，可展开查看出处。请在出发前核实预约与开放时间。</p>' : ''}
    ${visible.length ? `<ul class="places">${visible.map(place => `<li><div class="place-main"><span class="place-icon">${icon('pin')}</span><div><span class="tiny">${esc(place.category || '自选地点')}</span><h3>${esc(place.name)}</h3></div></div>
      <div class="place-controls"><select aria-label="${esc(place.name)}的意向" data-place="${esc(place.id)}">${Object.entries(choiceNames).map(([id,name]) => `<option value="${id}" ${place.state === id ? 'selected' : ''}>${name}</option>`).join('')}</select>${button('edit-place',icon('edit',14),'','icon-button',`data-id="${esc(place.id)}" aria-label="修改${esc(place.name)}"`)}</div>
      ${place.sourceIds?.length ? `<details class="sources"><summary>攻略来源</summary>${sourceLinks(place.sourceIds)}</details>` : ''}</li>`).join('')}</ul>` : emptyBlock('这里还没有地点','可以添加一个想去的地方，或调整上方的筛选。','pin')}
    ${places.length > 6 ? button('more-places',showAllPlaces ? '收起地点' : `查看全部 ${places.length} 个地点`,'down','button expand') : ''}
  </section>`;
}
function checklist(trip) {
  const items = [...(trip.plan || [])].sort((a,b) => a.day-b.day);
  return `<section class="paper-section"><div class="section-line"><div><div class="eyebrow">BEFORE DEPARTURE</div><h2>出发清单</h2></div>${button('add-plan','写下计划','plus','button small')}</div>
    ${items.length ? `<div class="checklist">${items.map(item => `<div class="plan-row"><label><input type="checkbox" data-check="${esc(item.id)}" ${item.done ? 'checked' : ''}><span><small>${dayLabel(item.day)}</small><strong>${esc(item.text)}</strong></span></label>${button('edit-plan',icon('edit'),'','icon-button',`data-id="${esc(item.id)}" aria-label="修改计划"`)}</div>`).join('')}</div>` : emptyBlock('还没有写下计划','可以先写一次预约、一段散步，或出发前要带的东西。','pages')}</section>`;
}
function journalPanel(trip) {
  const entries = [...(trip.journal || [])].sort((a,b) => a.day-b.day);
  let day = 0;
  return `<section class="paper-section journal"><div class="section-line"><div><div class="eyebrow">ALONG THE WAY</div><h2>每日手记</h2></div>${readonly ? '' : button('add-note','写一页','ink','button primary small')}</div>
    ${entries.length ? entries.map(entry => {
      const heading = entry.day !== day ? `<h3 class="day-heading"><span>DAY ${String(entry.day).padStart(2,'0')}</span>${dayLabel(entry.day)}</h3>` : '';
      day = entry.day;
      return `${heading}<article class="entry"><div class="section-line"><h4>${entry.place ? `${icon('pin',15)} ${esc(entry.place)}` : '沿途随记'}</h4>
        ${readonly ? '' : button('edit-note',icon('edit'),'','icon-button',`data-id="${esc(entry.id)}" aria-label="编辑这条手记"`)}</div>
        ${entry.text ? `<p class="note-body">${esc(entry.text)}</p>` : ''}
        ${entry.photos?.length ? `<div class="photo-grid">${entry.photos.map(photo => `<figure><a href="${photoUrl(photo.url)}" target="_blank" rel="noopener"><img loading="lazy" src="${photoUrl(photo.url)}" alt="${esc(photo.caption || entry.place || '手记中的照片')}"></a>${photo.caption ? `<figcaption>${esc(photo.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''}</article>`;
    }).join('') : emptyBlock('留给旅途的第一页', readonly ? '这本手账还没有分享每日记录。' : '到了想记住的地方，添一张照片，写下当时的小感受。','ink')}</section>`;
}
function detail(trip) {
  const isNew = selectedTripId !== trip.id;
  selectedTripId = trip.id;
  if (isNew) { activeTab = readonly ? 'journal' : 'plan'; placeFilter = 'all'; categoryFilter = ''; showAllPlaces = false; }
  main.innerHTML = `<div class="trip-page">${readonly ? `<div class="breadcrumb">${icon('book')} 共享手账</div>` : `<a class="breadcrumb" href="#/">${icon('back',16)} 返回书架</a>`}
    <header class="trip-cover"><div class="trip-cover-text"><div class="eyebrow">${readonly ? 'SHARED JOURNAL' : `TRAVEL JOURNAL　/　VOL. ${volume(trip)}`}</div><h1>${esc(trip.title)}</h1>
      <div class="trip-info">${badge(trip)}<span>${icon('pin',15)} ${esc(trip.city)}</span><span>${icon('calendar',15)} ${esc(dates(trip))}</span><span>${totalDays(trip)}</span></div>
      ${readonly ? '' : `<div class="trip-tools">${button('edit-trip','编辑手账','edit','button small')}${button('share','只读分享','share','button small')}</div>`}</div>${heroArt(trip)}</header>
    ${readonly ? journalPanel(trip) : `<div class="tabs" role="group" aria-label="阅读章节"><button data-action="tab" data-tab="plan" aria-pressed="${activeTab === 'plan'}">${icon('pages')}出发前的计划</button><button data-action="tab" data-tab="journal" aria-pressed="${activeTab === 'journal'}">${icon('ink')}每日手记</button></div>
    ${activeTab === 'plan' ? candidatePanel(trip)+checklist(trip) : journalPanel(trip)}`}</div>`;
}
function render() {
  if (!book) return;
  const hash = location.hash || '#/';
  if (readonly) {
    if (book.trips[0]) detail(book.trips[0]); else main.innerHTML = emptyBlock('这册手账暂不可读','请向分享者确认链接是否有效。','book');
  } else if (['#/','#/shelf','#/map'].includes(hash)) {
    home();
  } else {
    const found = book.trips.find(trip => tripLink(trip.id) === hash);
    if (found) detail(found);
    else { selectedTripId = ''; main.innerHTML = `<section class="error-view"><h1>没有找到这一册</h1><a class="button primary" href="#/">返回书架</a></section>`; }
  }
  main.querySelectorAll('.cover-image').forEach(img => { img.onerror = () => img.hidden = true; });
  document.title = selectedTripId ? `${currentTrip()?.title || '旅行手账'} · 慢慢走` : '慢慢走 · 旅行手账';
}

function dialog(title, body, size = '') {
  actionFocus = document.activeElement;
  modal.className = size;
  modal.innerHTML = `<div class="dialog-head"><div><div class="eyebrow">慢慢走　/　手账</div><h2 id="modal-title">${title}</h2></div>${button('close',icon('close'),'','icon-button','aria-label="关闭窗口"')}</div>
    <p class="form-error" role="alert" hidden></p>${body}`;
  if (!modal.open) modal.showModal();
}
function closeDialog() {
  if (modal.open) modal.close();
  if (actionFocus?.isConnected) actionFocus.focus({preventScroll:true});
}
function editor(title, kind, fields, id = '', deleteLabel = '') {
  dialog(title, `<form data-kind="${kind}" data-trip="${esc(selectedTripId)}" data-id="${esc(id)}"><div class="fields">${fields}</div>
    <div class="dialog-foot">${deleteLabel ? button('delete',deleteLabel,'trash','text-danger') : ''}<span class="spacer"></span>
    ${button('close','取消','','button small')}<button type="submit" class="button primary">${kind === 'create-trip' ? '创建手账' : '保存'}</button></div></form>`);
}
function openTripEditor(trip) {
  editor(trip ? '编辑手账' : '新建一册',trip ? 'edit-trip' : 'create-trip',
    `<label>旅行标题<input name="title" required maxlength="100" value="${esc(trip?.title || '')}" placeholder="给这次出发起个名字" autofocus></label>
     <label>城市<input name="city" required maxlength="60" value="${esc(trip?.city || '')}" placeholder="例如，南京"></label>
     <div class="field-pair"><label>出发日期 <small>选填</small><input type="date" name="startDate" value="${esc(trip?.startDate || '')}"></label>
     <label>旅行天数 <small>选填</small><input type="number" name="days" min="1" max="366" value="${esc(trip?.days || '')}" placeholder="待定"></label></div>
     <label>旅行状态<select name="status">${Object.entries(statusNames).map(([value,name]) => `<option value="${value}" ${(trip?.status || 'planned') === value ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`,
    trip?.id,trip ? '删除这册' : '');
}
function dayField(day, trip) {
  return `<label>第几天<input name="day" type="number" min="1" max="${Math.min(366,trip.days || 366)}" required value="${esc(day || 1)}"></label>`;
}
function openPlanEditor(item) {
  editor(item ? '修改计划' : '写下计划','plan',
    `${dayField(item?.day,currentTrip())}<label>计划内容<textarea name="text" rows="3" maxlength="1000" required placeholder="想去哪里，或出发前要办什么？">${esc(item?.text || '')}</textarea></label>`,
    item?.id,item ? '删除这项' : '');
}
function openNoteEditor(entry) {
  const trip = currentTrip();
  const day = entry?.day || Math.max(1,...trip.journal.map(note => note.day));
  editor(entry ? '编辑手记' : '写一页手记','note',
    `<div class="field-pair">${dayField(day,trip)}<label>地点 <small>选填</small><input name="place" maxlength="100" value="${esc(entry?.place || '')}" placeholder="在哪里？"></label></div>
    <label>当时的小感受<textarea name="text" rows="4" maxlength="10000" placeholder="记住一个画面，或留下一句话。">${esc(entry?.text || '')}</textarea></label>
    ${entry?.photos?.length ? `<div><strong class="field-title">已有照片</strong><div class="photo-fields">${entry.photos.map(photo => `<div class="photo-field"><img src="${photoUrl(photo.url)}" alt="${esc(photo.caption || '已保存照片')}"><label>照片说明<input name="caption-${esc(photo.id)}" maxlength="300" value="${esc(photo.caption)}"></label><label class="inline-check"><input type="checkbox" name="remove-${esc(photo.id)}">移除</label></div>`).join('')}</div></div>` : ''}
    <label>添加照片 <small>JPEG、PNG 或 WebP，每张至多 8 MB</small><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple></label><div id="new-captions"></div>`,
    entry?.id,entry ? '删除这条手记' : '');
}
function openPlaceEditor(place) {
  editor(place ? '修改地点' : '添加地点','place',`<label>地点名称<input name="name" required maxlength="256" value="${esc(place?.name)}" placeholder="最想去的地方" autofocus></label>
    <label>分类 <small>选填</small><input name="category" maxlength="256" value="${esc(place?.category)}" placeholder="例如，湖边散步"></label>
    <label>意向<select name="state">${Object.entries(choiceNames).map(([id,name]) => `<option value="${id}" ${id === place?.state ? 'selected' : ''}>${name}</option>`).join('')}</select></label>`,place?.id,place ? '删除地点' : '');
}
function openBackup() {
  dialog('手账备份',`<div class="fields"><p class="form-intro">备份包含旅行、计划、手记和照片。把文件保存在自己信任的位置。</p>
    <div class="backup-choice"><div>${icon('archive',22)}<strong>导出完整备份</strong></div><a class="button small" href="/api/backup" download="慢慢走-手账备份.json">下载备份 ${icon('down')}</a></div>
    <form data-kind="restore"><label>从备份恢复 <small>将替换现有内容</small><input type="file" name="backup" required accept=".json,application/json"></label>
    <p class="form-hint">请先导出当前手账。恢复后，重新创建需要分享的链接。</p><button class="button" type="submit">恢复备份</button></form></div>`);
}
function openShare() {
  dialog('分享这一册',`<div class="fields"><p class="form-intro">创建此刻的只读副本，包含旅行标题、日期、城市和每日手记中的照片。候选地点和出发清单保留在个人手账。</p>
    <button class="button primary" type="button" data-action="create-share">${icon('link')} 生成或更新只读链接</button>
    <div id="share-output" aria-live="polite"></div>
    ${button('revoke-share','撤销这册的分享','','text-danger')}</div>`);
}
function errorMessage(error) {
  const message = error.message || '保存失败，请再试一次。';
  const canReload = [409,412,428].includes(error.status);
  if (modal.open) {
    const box = modal.querySelector('.form-error');
    box.hidden = false;
    box.textContent = message;
    if (canReload) box.insertAdjacentHTML('beforeend',' '+button('reload','重新读取','','link-button'));
    if (error.status === 401) box.insertAdjacentHTML('beforeend',' <a href="/login">登录</a>');
  } else {
    render();
    const bar = document.createElement('div');
    bar.className = 'inline-error';
    bar.setAttribute('role','alert');
    bar.textContent = message+' ';
    if (canReload) bar.insertAdjacentHTML('beforeend',button('reload','重新读取','','link-button'));
    if (error.status === 401) bar.insertAdjacentHTML('beforeend',' <a href="/login">登录</a>');
    main.prepend(bar);
    bar.scrollIntoView({block:'nearest'});
  }
}
async function run(task) {
  if (busy) return;
  busy = true;
  document.body.setAttribute('aria-busy','true');
  main.inert = true;
  topbar.inert = true;
  modal.querySelectorAll('button, input, select, textarea').forEach(el => { if (!el.disabled) el.dataset.busyLock = 'true'; });
  const controls = Array.from(modal.querySelectorAll('[data-busy-lock]'));
  try {
    // Freeze controls after the task reads FormData before its first await.
    const result = task();
    controls.forEach(el => el.disabled = true);
    await result;
  } catch (error) {
    errorMessage(error);
  } finally {
    busy = false;
    document.body.removeAttribute('aria-busy');
    main.inert = false;
    topbar.inert = false;
    controls.forEach(el => { el.disabled = false; delete el.dataset.busyLock; });
  }
}
function entryById(trip,id,key) { return trip?.[key]?.find(item => item.id === id); }
function getTrip(draft,id) {
  const trip = draft.trips.find(item => item.id === id);
  if (!trip) throw new Error('找不到这册手账。请重新读取。');
  return trip;
}
function replaceOrAdd(list, item) {
  const index = list.findIndex(old => old.id === item.id);
  if (index === -1) list.push(item);
  else list[index] = item;
}
function required(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`请填写${label}。`);
  return text;
}
async function preparePhotos(form,fields,existing) {
  const retained = (existing || []).filter(photo => !fields.has(`remove-${photo.id}`)).map(photo => ({
    ...photo,caption:String(fields.get(`caption-${photo.id}`) || '').trim()
  }));
  const files = Array.from(form.elements.photos.files);
  for (const file of files) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPEG、PNG 或 WebP 格式的照片。');
    if (file.size > 8*1024*1024) throw new Error('单张照片需小于或等于 8 MB。');
  }
  for (const [index,file] of files.entries()) {
    let saved = extraPhotos.get(file);
    if (!saved) {
      const response = await request('/api/photos',{method:'POST',headers:{'Content-Type':file.type},body:file});
      saved = await response.json();
      extraPhotos.set(file,saved);
    }
    retained.push({...saved,caption:String(fields.get(`new-caption-${index}`) || '').trim()});
  }
  return retained;
}
async function handleSubmit(form) {
  const fields = new FormData(form);
  const kind = form.dataset.kind;
  const tripId = form.dataset.trip;
  const id = form.dataset.id || crypto.randomUUID();
  const val = name => String(fields.get(name) || '').trim();
  let destination = '';
  if (kind === 'restore') {
    const file = form.elements.backup.files[0];
    if (!file || !window.confirm('确定用此备份替换全部手账和照片？恢复前建议下载当前备份。')) return;
    const response = await request('/api/backup',{method:'POST',headers:{'Content-Type':'application/json','If-Match':etag},body:file});
    book = await response.json();
    etag = responseRevision(response);
    if (!etag) await loadBook();
    destination = '#/';
  } else if (kind === 'create-trip' || kind === 'edit-trip') {
    const values = {title:required(val('title'),'旅行标题'),city:required(val('city'),'城市'),startDate:val('startDate'),days:val('days') ? Number(val('days')) : null,status:val('status')};
    await saveChange(draft => {
      if (kind === 'create-trip') draft.trips.push({id,...values,candidates:[],plan:[],journal:[]});
      else {
        const trip = getTrip(draft,tripId);
        if (values.days && [...trip.plan,...trip.journal].some(item => item.day > values.days)) {
          throw new Error('已有计划或手记超过这个天数，请先调整对应记录。');
        }
        Object.assign(trip,values);
      }
    });
    if (kind === 'create-trip') destination = tripLink(id);
  } else if (kind === 'plan') {
    const text = required(val('text'),'计划内容');
    await saveChange(draft => {
      const {plan} = getTrip(draft,tripId);
      replaceOrAdd(plan,{id,day:Number(val('day')),text,done:plan.find(item => item.id === id)?.done || false});
    });
  } else if (kind === 'place') {
    const name = required(val('name'),'地点名称');
    await saveChange(draft => {
      const {candidates} = getTrip(draft,tripId);
      const sourceIds = candidates.find(place => place.id === id)?.sourceIds || [];
      replaceOrAdd(candidates,{id,name,category:val('category') || '自选地点',state:val('state'),sourceIds});
    });
    categoryFilter = '';
    placeFilter = val('state');
    showAllPlaces = true;
  } else if (kind === 'note') {
    const existing = entryById(getTrip(book,tripId),id,'journal');
    const photos = await preparePhotos(form,fields,existing?.photos);
    const entry = {id,day:Number(val('day')),place:val('place'),text:val('text'),photos};
    if (!entry.text && !entry.place && !photos.length) throw new Error('写下一个地点、一句感受，或添加一张照片。');
    await saveChange(draft => replaceOrAdd(getTrip(draft,tripId).journal,entry));
  } else return;
  closeDialog();
  if (destination && location.hash !== destination) location.hash = destination;
  else render();
  toast(kind === 'restore' ? '已恢复手账' : '已保存');
}
async function deleteItem() {
  const form = modal.querySelector('form');
  if (!form) return;
  const kind = form.dataset.kind, id = form.dataset.id, tripId = form.dataset.trip;
  const label = kind === 'edit-trip' ? '整册旅行及其中的计划、手记和照片' : kind === 'plan' ? '这项计划' : kind === 'place' ? '这个地点' : '这条手记';
  if (!window.confirm(`确定删除${label}？本次删除无法撤销。`)) return;
  await saveChange(draft => {
    if (kind === 'edit-trip') draft.trips = draft.trips.filter(trip => trip.id !== tripId);
    else {
      const trip = getTrip(draft,tripId);
      const key = kind === 'plan' ? 'plan' : kind === 'place' ? 'candidates' : 'journal';
      trip[key] = trip[key].filter(item => item.id !== id);
    }
  });
  closeDialog();
  if (kind === 'edit-trip') location.hash = '#/';
  else render();
  toast('已删除');
}
async function generateShare() {
  const response = await request('/api/share',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tripId:selectedTripId})});
  const result = await response.json();
  const url = new URL(result.url,location.origin);
  if (url.origin !== location.origin || !url.pathname.startsWith('/s/')) throw new Error('分享链接无效，请重试。');
  const scope = result.audience === 'owner-private' ? '当前站点仅你可访问，可在此预览只读版本。' : '持链接可查看此副本，实际可见范围以站点访问权限为准。';
  modal.querySelector('#share-output').innerHTML = `<p class="form-hint">${scope}</p><label>只读链接<input readonly value="${esc(url.href)}" id="share-url"></label>
    <div class="button-group">${button('copy-share','复制链接','link','button small')}<a class="button small" href="${esc(url.href)}" target="_blank" rel="noopener">打开预览 ↗</a></div>`;
}
const actions = {
  'close':closeDialog,
  'create-trip':() => openTripEditor(null),
  'edit-trip':() => openTripEditor(currentTrip()),
  'add-place':() => openPlaceEditor(null),
  'edit-place':el => openPlaceEditor(entryById(currentTrip(),el.dataset.id,'candidates')),
  'add-plan':() => openPlanEditor(null),
  'edit-plan':el => openPlanEditor(entryById(currentTrip(),el.dataset.id,'plan')),
  'add-note':() => openNoteEditor(null),
  'edit-note':el => openNoteEditor(entryById(currentTrip(),el.dataset.id,'journal')),
  'backup':openBackup,
  'share':openShare,
  'create-share':() => run(generateShare),
  'revoke-share':() => run(async () => {
    if (!window.confirm('撤销后旧链接将失效，确定继续？')) return;
    await request(`/api/share/${encodeURIComponent(selectedTripId)}`,{method:'DELETE'});
    closeDialog(); toast('已撤销只读链接');
  }),
  'copy-share':() => {
    const input = document.getElementById('share-url');
    input.focus(); input.select();
    if (!navigator.clipboard) return toast('链接已选中，可以复制');
    navigator.clipboard.writeText(input.value).then(() => toast('链接已复制'),() => toast('链接已选中，可以复制'));
  },
  'delete':() => run(deleteItem),
  'filter':el => { placeFilter = el.dataset.filter; showAllPlaces = false; render(); main.querySelector(`[data-filter="${CSS.escape(placeFilter)}"]`)?.focus({preventScroll:true}); },
  'more-places':() => { showAllPlaces = !showAllPlaces; render(); main.querySelector('[data-action="more-places"]')?.focus({preventScroll:true}); },
  'tab':el => { activeTab = el.dataset.tab; render(); main.querySelector(`[data-tab="${activeTab}"]`)?.focus({preventScroll:true}); },
  'city':el => {
    cityFilter = el.dataset.city;
    const matches = book.trips.filter(trip => trip.city === cityFilter);
    if (matches.length === 1) { cityFilter = ''; location.hash = tripLink(matches[0].id); }
    else { render(); document.getElementById('shelf')?.scrollIntoView(); }
  },
  'reset-city':() => { cityFilter = ''; render(); },
  'reload':() => run(async () => {
    if (modal.open && !window.confirm('重新读取将关闭编辑窗口。请先复制未保存的文字。确定继续？')) return;
    await loadBook();
    closeDialog(); masthead(); render(); toast('已重新读取');
  })
};
document.addEventListener('click',event => {
  if (event.target.closest('.skip-link')) {
    event.preventDefault(); main.focus(); return;
  }
  const el = event.target.closest('[data-action]');
  if (!el || busy || readonly && el.dataset.action !== 'reload') return;
  actions[el.dataset.action]?.(el);
});
document.addEventListener('change',event => {
  if (readonly || busy) return;
  const el = event.target;
  if (el.matches('[data-category]')) {
    categoryFilter = el.value; showAllPlaces = false; render();
    main.querySelector('[data-category]')?.focus({preventScroll:true});
  } else if (el.matches('input[name="photos"]')) {
    document.getElementById('new-captions').innerHTML = Array.from(el.files).map((file,index) =>
      `<label class="new-caption">${esc(file.name)} <small>照片说明，可选</small><input name="new-caption-${index}" maxlength="300"></label>`).join('');
  } else if (el.matches('[data-place], [data-check]')) {
    const tripId = selectedTripId;
    const value = el.value, checked = el.checked;
    run(async () => {
      await saveChange(draft => {
        const trip = getTrip(draft,tripId);
        if (el.dataset.place) entryById(trip,el.dataset.place,'candidates').state = value;
        else entryById(trip,el.dataset.check,'plan').done = checked;
      });
      render();
      const selector = el.dataset.place ? `[data-place="${CSS.escape(el.dataset.place)}"]` : `[data-check="${CSS.escape(el.dataset.check)}"]`;
      main.querySelector(selector)?.focus({preventScroll:true});
      toast('已保存');
    });
  }
});
modal.addEventListener('submit',event => {
  event.preventDefault();
  if (readonly || busy || !event.target.reportValidity()) return;
  run(() => handleSubmit(event.target));
});
modal.addEventListener('cancel',event => { if (busy) event.preventDefault(); });
window.addEventListener('hashchange',() => {
  closeDialog();
  render();
  const anchor = location.hash === '#/map' ? 'map' : location.hash === '#/shelf' ? 'shelf' : '';
  if (anchor) document.getElementById(anchor)?.scrollIntoView();
  else { main.focus({preventScroll:true}); window.scrollTo(0,0); }
});
async function init() {
  masthead();
  try {
    await loadBook();
    render();
    const section = location.hash === '#/map' ? 'map' : location.hash === '#/shelf' ? 'shelf' : '';
    if (section) document.getElementById(section)?.scrollIntoView();
  } catch (error) {
    const heading = readonly && error.status === 404 ? '这份分享已失效' : '暂时无法翻开手账';
    main.innerHTML = `<section class="error-view">${icon('book',35)}<h1>${heading}</h1><p>${esc(error.message)}</p>
      ${error.status === 401 && !readonly ? '<a class="button primary" href="/login">前往登录</a>' : button('reload','重新读取','','button')}</section>`;
  }
}
init();
