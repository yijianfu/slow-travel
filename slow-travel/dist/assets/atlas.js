'use strict';
let atlasView = {x:0,y:0,w:648,h:440};
function atlasCities() {
  return (book.cities || []).map(city => {
    const trips = book.trips.filter(t => t.cityId === city.id);
    return {...city,...cityLocation(city.name),trips,status:trips.some(t => t.status === 'completed' || t.status === 'ongoing') ? 'visited' : 'planned'};
  });
}
function atlasHome() {
  selectedTripId = '';
  selectedCityId = '';
  const cities = atlasCities();
  main.innerHTML = `<div class="atlas-page"><header class="atlas-heading"><div><p class="eyebrow">我的旅行地图</p><h1>慢慢走过，慢慢记得。</h1></div>${button('add-city','添加城市','plus','button primary small')}</header>
    <div class="atlas-layout"><section class="atlas-paper" aria-label="个人旅行地图"><div class="atlas-corner">慢慢走 <span>·</span> 旅行足迹</div>
      <svg id="travel-atlas" viewBox="${atlasView.x} ${atlasView.y} ${atlasView.w} ${atlasView.h}" role="group" aria-label="城市地图，可拖动，滚轮或按钮缩放" tabindex="0">
      <image href="/assets/china-map.svg" x="0" y="0" width="648" height="440"/>
      ${cities.filter(c => c.position).map(city => `<g class="atlas-pin ${city.status}" data-action="open-city" data-city="${esc(city.id)}" role="button" tabindex="0" aria-label="打开${esc(city.name)}，${city.trips.length}次旅行" transform="translate(${city.position.x*6.48} ${city.position.y*4.4})"><g class="pin-size"><circle class="pin-halo" r="11"/><circle class="pin-dot" r="4"/><text x="10" y="4">${esc(city.name)}</text></g></g>`).join('')}</svg>
      <div class="atlas-legend"><span><i class="visited"></i>去过的城市</span><span><i class="planned"></i>想去的城市</span></div>
      <div class="atlas-controls">${button('zoom-in','＋','','icon-button','aria-label="放大地图"')}${button('zoom-out','−','','icon-button','aria-label="缩小地图"')}${button('zoom-reset','全图','','button small')}</div>
      <p class="atlas-instruction">拖动地图 · 缩放看看城市</p></section>
      <aside class="atlas-index"><div class="section-line"><h2>我的城市</h2><span class="quiet">${cities.length} 座</span></div><p class="chapter-description">一次次出发，收进同一座城市。</p>
      <div class="atlas-city-list">${cities.map(city => `<a href="${cityLink(city.id)}" class="atlas-city-row"><i class="city-dot ${city.status}"></i><div><strong>${esc(city.name)}</strong><small>${city.trips.length ? `${city.trips.filter(t => t.status === 'completed').length} 次归来 · ${city.trips.filter(t => t.status !== 'completed').length} 次计划` : '还没有旅行'}${!city.position ? ' · 暂未定位' : ''}</small></div>${icon('arrow',16)}</a>`).join('') || `<div class="city-empty"><p>先为想去的城市<br>在地图上留个位置。</p>${button('add-city','添加第一个城市','plus','link-button')}</div>`}</div>
      <a class="all-trips-link" href="#/shelf">${icon('book')} 查看全部旅行 ${icon('arrow',15)}</a></aside></div>
    <p class="atlas-credit">地图底图 · Natural Earth　城市坐标 · <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames</a></p></div>`;
  bindAtlas();
}
function bindAtlas() {
  const svg = document.getElementById('travel-atlas');
  if (!svg) return;
  const pointers = new Map();
  let previous = null, moved = false, downCity = '';
  const update = () => {
    atlasView.w = Math.min(648,Math.max(54,atlasView.w)); atlasView.h = atlasView.w*440/648;
    atlasView.x = Math.max(-30,Math.min(678-atlasView.w,atlasView.x));
    atlasView.y = Math.max(-20,Math.min(460-atlasView.h,atlasView.y));
    svg.setAttribute('viewBox',`${atlasView.x} ${atlasView.y} ${atlasView.w} ${atlasView.h}`);
    const scale=1/Math.abs(svg.getScreenCTM()?.a || 1);
    svg.querySelectorAll('.pin-size').forEach(pin => pin.setAttribute('transform',`scale(${scale})`));
  };
  const point = (x,y) => new DOMPoint(x,y).matrixTransform(svg.getScreenCTM().inverse());
  const zoom = (factor,x,y) => {
    const old = {...atlasView}, w = Math.min(648,Math.max(54,old.w*factor));
    const focus = x === undefined ? {x:old.x+old.w/2,y:old.y+old.h/2} : point(x,y);
    atlasView.x = focus.x-(focus.x-old.x)*w/old.w; atlasView.y = focus.y-(focus.y-old.y)*w/old.w;
    atlasView.w = w; update();
  };
  svg.atlasZoom = zoom; svg.atlasReset = () => { atlasView={x:0,y:0,w:648,h:440}; update(); };
  function gesture() {
    const pts = [...pointers.values()];
    return {x:pts.reduce((s,p)=>s+p.x,0)/pts.length,y:pts.reduce((s,p)=>s+p.y,0)/pts.length,d:pts.length===2 ? Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y) : 0};
  }
  svg.addEventListener('pointerdown',e => { if (e.button !== 0) return; downCity=e.target.closest('.atlas-pin')?.dataset.city || ''; pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); previous=gesture(); moved=pointers.size>1; svg.setPointerCapture(e.pointerId); svg.classList.add('dragging'); });
  svg.addEventListener('pointermove',e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); const next=gesture();
    const a=point(previous.x,previous.y),b=point(next.x,next.y);
    if (Math.abs(next.x-previous.x)+Math.abs(next.y-previous.y)>2) moved=true;
    atlasView.x += a.x-b.x; atlasView.y += a.y-b.y;
    if (previous.d && next.d) { moved=true; zoom(previous.d/next.d,next.x,next.y); } else update();
    previous=next;
  });
  const finish=e => { pointers.delete(e.pointerId); previous=pointers.size?gesture():null; svg.classList.remove('dragging'); if(e.type==='pointerup'&&!moved&&downCity) location.hash=cityLink(downCity); downCity=''; };
  svg.addEventListener('pointerup',finish); svg.addEventListener('pointercancel',finish);
  svg.addEventListener('click',e => { if (moved) {e.stopImmediatePropagation(); moved=false;} },true);
  svg.addEventListener('wheel',e => { e.preventDefault(); zoom(Math.exp(e.deltaY*.002),e.clientX,e.clientY); },{passive:false});
  svg.addEventListener('keydown',e => {
    const city=e.target.closest('.atlas-pin');
    if (city && ['Enter',' '].includes(e.key)) {e.preventDefault();location.hash=cityLink(city.dataset.city);return;}
    if (['+','=','-','0'].includes(e.key)) {e.preventDefault();e.key==='0'?svg.atlasReset():zoom(e.key==='-'?1.4:1/1.4);}
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
      e.preventDefault(); atlasView.x+=e.key==='ArrowLeft'?-atlasView.w/10:e.key==='ArrowRight'?atlasView.w/10:0;
      atlasView.y+=e.key==='ArrowUp'?-atlasView.h/10:e.key==='ArrowDown'?atlasView.h/10:0; update();
    }
  });
  const resize=new ResizeObserver(()=>{if(svg.isConnected) update();else resize.disconnect();});
  resize.observe(svg); update();
}
