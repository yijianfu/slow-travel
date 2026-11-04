export const BOOK_LIMIT = 4 * 1024 * 1024;
export const PHOTO_LIMIT = 8 * 1024 * 1024;
export const BACKUP_LIMIT = 96 * 1024 * 1024;
export const LIBRARY_PHOTO_LIMIT = 64 * 1024 * 1024;

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function string(value, label, maximum = 256, required = false) {
  expect(typeof value === 'string' && value.length <= maximum, label + '格式或长度无效');
  if (required) expect(value.trim(), label + '不能为空');
  return value;
}

export function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
}

function id(value) {
  expect(validId(value), '标识格式无效');
  return value;
}

function rows(value, mapper, label, maximum = 1000) {
  expect(Array.isArray(value) && value.length <= maximum, label + '列表格式或数量无效');
  const seen = new Set();
  return value.map(item => {
    expect(item && typeof item === 'object' && !Array.isArray(item), label + '格式无效');
    const key = id(item.id);
    expect(!seen.has(key), label + '标识重复');
    seen.add(key);
    return mapper(item);
  });
}

function date(value) {
  if (value === '') return '';
  expect(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '日期格式无效');
  const parsed = new Date(value + 'T00:00:00Z');
  expect(Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value, '日期无效');
  return value;
}

function day(value) {
  expect(Number.isInteger(value) && value >= 1 && value <= 366, '旅程天数应在 1 至 366 之间');
  return value;
}

function link(value) {
  if (value === '') return '';
  string(value, '资料链接', 8192);
  let url;
  try { url = new URL(value); } catch { throw new Error('资料链接无效'); }
  expect(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, '资料链接无效');
  return value;
}

export function validateBook(value) {
  expect(value?.version === 1, '无法识别手账版本');
  const sources = rows(value.sources, s => ({
    id:s.id, title:string(s.title, '资料标题', 400, true),
    archiveUrl:link(s.archiveUrl), originalUrl:link(s.originalUrl)
  }), '资料');
  const sourceIds = new Set(sources.map(s => s.id));
  const cityKey = name => name.normalize('NFKC').replace(/\s+/g,'').replace(/^中国/,'').replace(/^.*省/,'').replace(/(特别行政区|自治州|地区|盟|市)$/,'').toLowerCase();
  const cities = rows(value.cities ?? [], c => ({
    id:c.id,name:string(c.name,'城市',100,true),
    places:rows(c.places,p => {
      expect(['place','food'].includes(p.kind),'地点分类无效');
      expect(typeof p.visited === 'boolean','到访状态无效');
      expect(Array.isArray(p.sourceIds) && p.sourceIds.length <= 100 && p.sourceIds.every(s => sourceIds.has(s)),'地点来源无效');
      return {id:p.id,name:string(p.name,'地点',256,true),kind:p.kind,note:string(p.note,'备注',8000),visited:p.visited,sourceIds:[...new Set(p.sourceIds)]};
    },'城市地点')
  }),'城市');
  const photo = p => ({id:id(p.id),url:'/api/photos/' + p.id,caption:string(p.caption ?? '','照片说明',2000)});
  const trips = rows(value.trips, t => {
    expect(['planned','ongoing','completed'].includes(t.status), '旅行状态无效');
    const candidates = rows(t.candidates, c => {
      expect(['candidate','wanted','maybe'].includes(c.state), '地点状态无效');
      expect(Array.isArray(c.sourceIds) && c.sourceIds.length <= 100 && c.sourceIds.every(s => sourceIds.has(s)), '候选地点来源无效');
      return {id:c.id, name:string(c.name,'地点',256,true), category:string(c.category,'分类'), state:c.state, sourceIds:[...new Set(c.sourceIds)]};
    }, '候选地点');
    const plan = rows(t.plan, p => {
      expect(typeof p.done === 'boolean', '清单状态无效');
      return {id:p.id, day:day(p.day), text:string(p.text,'计划',8000,true), done:p.done, ...(p.placeId ? {placeId:id(p.placeId)} : {})};
    }, '计划');
    const journal = rows(t.journal, e => ({
      id:e.id, day:day(e.day), place:string(e.place,'地点'), text:string(e.text,'感受',32000),
      photos:rows(e.photos, photo, '照片', 100)
    }), '记录');
    return {
      id:t.id, title:string(t.title,'旅行标题',200,true), city:string(t.city,'城市',100,true),
      startDate:date(t.startDate), days:t.days === null ? null : day(t.days), status:t.status, candidates, plan, journal,
      cityId:t.cityId ? id(t.cityId) : '',cover:t.cover ? photo(t.cover) : null,feeling:string(t.feeling ?? '','一句感受',500)
    };
  }, '旅行', 1000);
  for (const trip of trips) {
    let city = trip.cityId && cities.find(c => c.id === trip.cityId);
    if (!city) city = cities.find(c => cityKey(c.name) === cityKey(trip.city));
    if (!city) {
      let key = 'city-' + trip.id.slice(0,90);
      while (cities.some(c => c.id === key)) key += '_';
      city = {id:key,name:trip.city,places:[]}; cities.push(city);
    }
    trip.cityId = city.id;
    if (value.cities === undefined) {
      for (const candidate of trip.candidates) {
        const existing = city.places.find(p => cityKey(p.name) === cityKey(candidate.name));
        if (existing) existing.sourceIds = [...new Set([...existing.sourceIds,...candidate.sourceIds])];
        else {
          let key = candidate.id;
          while (city.places.some(p => p.id === key)) key += '_';
          city.places.push({id:key,name:candidate.name,kind:/吃|食|餐|面|小吃/.test(candidate.category) ? 'food' : 'place',note:candidate.category,visited:false,sourceIds:candidate.sourceIds});
        }
      }
    }
    for (const item of trip.plan) if (item.placeId) expect(city.places.some(p => p.id === item.placeId),'计划关联地点不存在');
  }
  const book = {version:1,trips,sources,cities};
  expect(new TextEncoder().encode(JSON.stringify(book)).length <= BOOK_LIMIT, '手账文字已超过 4 MiB');
  return book;
}

export function referencedPhotos(book) {
  const result = new Set();
  for (const trip of book.trips) {
    if (trip.cover) result.add(trip.cover.id);
    for (const entry of trip.journal) {
      for (const photo of entry.photos) result.add(photo.id);
    }
  }
  return result;
}

export function shareSnapshot(book, tripId) {
  const trip = validateBook(book).trips.find(t => t.id === tripId);
  if (!trip) return null;
  return {version:1, trips:[{...structuredClone(trip), candidates:[], plan:[],cityId:''}], sources:[],cities:[]};
}

export function presentShared(snapshot, token) {
  const book = structuredClone(snapshot);
  if (book.trips[0].cover) book.trips[0].cover.url = '/api/shared/' + token + '/photos/' + book.trips[0].cover.id;
  for (const entry of book.trips[0].journal) {
    for (const photo of entry.photos) photo.url = '/api/shared/' + token + '/photos/' + photo.id;
  }
  return book;
}

export function validatePhoto(bytes, mime) {
  expect(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= PHOTO_LIMIT, '照片为空或超过 8 MiB');
  const matches = (offset, signature) => signature.every((value,index) => bytes[offset + index] === value);
  const valid = (mime === 'image/jpeg' && matches(0,[255,216,255])) ||
    (mime === 'image/png' && matches(0,[137,80,78,71,13,10,26,10])) ||
    (mime === 'image/webp' && matches(0,[82,73,70,70]) && matches(8,[87,69,66,80]));
  expect(valid, '请选择 JPEG、PNG 或 WebP 图片，且内容与格式必须相符');
  return mime;
}

export function validateBackup(payload) {
  expect(payload?.format === 'slow-travel-backup' && payload.version === 1, '无法识别备份格式');
  const book = validateBook(payload.book);
  const wanted = referencedPhotos(book);
  let total = 0;
  const photos = rows(payload.photos, p => {
    expect(wanted.has(p.id), '备份含有未引用的照片');
    expect(typeof p.data === 'string' && p.data.length <= Math.ceil(PHOTO_LIMIT / 3) * 4, '备份照片过大或格式无效');
    let binary;
    try { binary = atob(p.data); } catch { throw new Error('备份照片编码损坏'); }
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    total += bytes.length;
    expect(total <= LIBRARY_PHOTO_LIMIT, '手账照片总量超过 64 MiB');
    const mime = validatePhoto(bytes, p.mime);
    wanted.delete(p.id);
    return {id:p.id,mime,bytes};
  }, '备份照片', 20000);
  expect(wanted.size === 0, '备份缺少日记引用的照片');
  return {book,photos};
}
