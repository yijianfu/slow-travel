'use strict';
let selectedCityId = '';
let wishKind = 'place';
function syncCityVisits(draft,cityId,placeIds) {
  const city=draft.cities.find(c=>c.id===cityId);
  if(!city) return;
  for(const place of city.places) if(placeIds.includes(place.id)) {
    place.visited=draft.trips.some(t=>t.cityId===cityId && t.plan.some(p=>p.placeId===place.id && p.done));
  }
}
function cityLink(id) { return '#/cities/' + encodeURIComponent(id); }
function currentCity() { return book.cities?.find(c => c.id === selectedCityId || c.id === currentTrip()?.cityId); }
function tripCard(trip) {
  return `<a class="travel-card" href="${tripLink(trip.id)}"><div class="travel-card-cover">${trip.cover ? `<img src="${photoUrl(trip.cover.url)}" alt="${esc(trip.cover.caption || trip.title)}" loading="lazy">` : `<div class="blank-cover"><span>${esc(trip.city)}</span><small>留一张旅途中的照片</small></div>`}${badge(trip)}</div><div class="travel-card-copy"><p class="card-date">${esc(dates(trip))} <span>·</span> ${totalDays(trip)}</p><h3>${esc(trip.title)}</h3><p class="card-feeling ${trip.feeling ? '' : 'is-empty'}">${esc(trip.feeling || (trip.status==='completed'?'还没有写下这次的感受':'留给这次出发的一句话'))}</p><span class="card-open">${trip.status==='completed'?'翻开手账':'看看计划'} ${icon('arrow',16)}</span></div></a>`;
}
function cityPage(city) {
  selectedTripId=''; selectedCityId=city.id;
  const trips=book.trips.filter(t=>t.cityId===city.id).slice().reverse();
  const planned=trips.filter(t=>t.status!=='completed'),completed=trips.filter(t=>t.status==='completed');
  const wishes=city.places.filter(p=>!p.visited);
  main.innerHTML=`<div class="city-page"><a class="breadcrumb" href="#/">${icon('back',16)} 我的旅行地图</a>
    <header class="city-heading"><div><p class="eyebrow">我的城市手账</p><h1>${esc(city.name)}<small>${trips.length} 次旅行</small></h1><p>去过的留在手账里，想去的留给下一次。</p></div><div class="city-heading-actions">${button('wishlist',`${icon('cart')} 未去清单 <b>${wishes.length}</b>`,'','button wish-button')}${button('create-trip','新的旅行','plus','button primary')}</div></header>
    <section class="city-chapter"><div class="section-line"><h2>下一次出发 <small>${planned.length}</small></h2></div>${planned.length ? `<div class="travel-cards">${planned.map(tripCard).join('')}</div>` : `<div class="city-empty-line"><p>下次什么时候来，都可以先记下。</p>${button('create-trip','计划一次旅行','plus','link-button')}</div>`}</section>
    <section class="city-chapter"><div class="section-line"><h2>已经走过 <small>${completed.length}</small></h2></div>${completed.length ? `<div class="travel-cards">${completed.map(tripCard).join('')}</div>` : `<p class="city-empty-line">旅行结束后，把沿途的照片和小感受收在这里。</p>`}</section></div>`;
}
function allTrips() {
  selectedTripId='';selectedCityId='';
  main.innerHTML=`<div class="city-page"><a class="breadcrumb" href="#/">${icon('back',16)} 我的旅行地图</a><header class="city-heading"><div><p class="eyebrow">我的旅行收藏</p><h1>所有旅行</h1></div>${button('create-trip','新的旅行','plus','button primary')}</header><div class="travel-cards">${book.trips.slice().reverse().map(tripCard).join('') || emptyBlock('还没有旅行','从地图上添加一个想去的城市开始。','book')}</div></div>`;
}
function openCityEditor() {
  editor('为城市留个位置','city',`<label>城市名称<input name="name" required maxlength="100" placeholder="例如，南京" autofocus list="city-suggestions"></label><datalist id="city-suggestions">${['南京','北京','上海','杭州','苏州','成都','西安','重庆','武汉','长沙','厦门','广州','深圳','青岛','大理','泉州'].map(c=>`<option value="${c}">`).join('')}</datalist><p class="form-hint">添加后可以收集想去的地点和美食，再慢慢计划旅行。</p>`);
}
function openWishlist() {
  const city=currentCity(); if(!city) return;
  const places=city.places.filter(p=>!p.visited && p.kind===wishKind);
  dialog(`${esc(city.name)} · 未去清单`,`<p class="form-intro">只收还没去过的地方。加入行程后会保留，实际打卡后再移出。</p><div class="wishlist-tabs">${[['place','地点'],['food','美食']].map(([k,n])=>button('wish-kind',`${n} <span>${city.places.filter(p=>!p.visited&&p.kind===k).length}</span>`,'',k===wishKind?'button primary small':'button small',`data-kind="${k}" aria-pressed="${k===wishKind}"`)).join('')}${button('add-wish',wishKind==='food'?'记一份美食':'记一个地点','plus','link-button')}</div>
    <div class="wishlist-items">${places.map(p=>`<article class="wish-item"><div><h3>${esc(p.name)}</h3>${p.note?`<p>${esc(p.note)}</p>`:''}${p.sourceIds.length?`<details class="wish-source"><summary>攻略出处</summary>${sourceLinks(p.sourceIds)}</details>`:''}</div><div class="wish-actions">${button('assign-wish','加入行程','','button small',`data-id="${esc(p.id)}"`)}${button('edit-wish',icon('edit'),'','icon-button',`data-id="${esc(p.id)}" aria-label="修改${esc(p.name)}"`)}</div></article>`).join('') || `<div class="city-empty"><p>记下想${wishKind==='food'?'吃的一份美食':'去的一个地方'}，留给下一次出发。</p></div>`}</div>`,'wishlist-dialog');
}
function openWishEditor(place) {
  editor(place?'修改收藏':'记下一个想去的地方','wish',`<input type="hidden" name="cityId" value="${esc(currentCity().id)}"><label>名称<input name="name" maxlength="256" required autofocus value="${esc(place?.name||'')}" placeholder="地点或美食的名字"></label><label>分类<select name="kind"><option value="place" ${(place?.kind||wishKind)==='place'?'selected':''}>地点</option><option value="food" ${(place?.kind||wishKind)==='food'?'selected':''}>美食</option></select></label><label>备注 <small>选填</small><textarea name="note" rows="3" maxlength="8000" placeholder="为什么想去、地址或想吃的菜">${esc(place?.note||'')}</textarea></label>`,place?.id,place?'删除收藏':'');
}
function openAssignWish(id) {
  const city=currentCity(),place=city.places.find(p=>p.id===id);
  const trips=book.trips.filter(t=>t.cityId===city.id&&t.status!=='completed');
  if(!trips.length) {
    dialog('先为这座城市计划一次旅行',`<p class="form-intro">${esc(place.name)}会保留在未去清单中，创建旅行后就能把它加入某一天。</p>${button('create-trip','新的旅行','plus','button primary')}`);return;
  }
  editor(`把${esc(place.name)}加入行程`,'assign-wish',`<input type="hidden" name="cityId" value="${esc(city.id)}"><label>选择旅行<select name="targetTrip">${trips.map(t=>`<option value="${esc(t.id)}" ${t.id===selectedTripId?'selected':''}>${esc(t.title)}</option>`).join('')}</select></label><label>第几天<input name="day" type="number" min="1" max="366" required value="1"></label><p class="form-hint">加入后仍在未去清单中。到访后，在行程里勾选打卡。</p>`,id);
}
function openCoverEditor() {
  const trip=currentTrip(),photos=[...new Map(trip.journal.flatMap(e=>e.photos).map(p=>[p.id,p])).values()];
  editor('封面与一句感受','cover',`<label>这次旅行的一句话<textarea name="feeling" rows="2" maxlength="500" placeholder="只属于这次旅行的小感受">${esc(trip.feeling||'')}</textarea></label><div><strong class="field-title">选择封面</strong><div class="cover-choices"><label class="cover-choice"><input type="radio" name="coverId" value="" ${!trip.cover?'checked':''}><span>暂时留白</span></label>${[...(trip.cover && !photos.some(p=>p.id===trip.cover.id)?[trip.cover]:[]),...photos].map(p=>`<label class="cover-choice"><input type="radio" name="coverId" value="${esc(p.id)}" ${trip.cover?.id===p.id?'checked':''}><img src="${photoUrl(p.url)}" alt="${esc(p.caption||'手记照片')}"></label>`).join('')}</div></div><label>或上传一张封面 <small>JPEG、PNG、WebP，至多 8 MB</small><input type="file" name="coverPhoto" accept="image/jpeg,image/png,image/webp"></label><p class="form-hint">上传的照片会作为封面，不会自动添加到每日手记。</p>`);
}
