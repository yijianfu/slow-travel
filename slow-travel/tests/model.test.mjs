import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBook, validateBackup, shareSnapshot, presentShared, referencedPhotos} from '../server/model.mjs';

export function sample() {
  return {version: 1, sources: [{id:'S01',title:'参考',archiveUrl:'https://example.org/n',originalUrl:''}], trips: [{
    id:'nanjing',title:'南京',city:'南京',startDate:'',days:null,status:'planned',
    candidates:[{id:'lake',name:'玄武湖',category:'散步',state:'maybe',sourceIds:['S01']}],
    plan:[{id:'plan',day:1,text:'看看湖面',done:false}], journal: []
  }]};
}

test('plan remains distinct from an empty diary on an undated trip', () => {
  const book = sample();
  assert.deepEqual(validateBook(book).trips[0].journal, book.trips[0].journal);
  assert.throws(() => validateBook({...book,trips:[...book.trips,...book.trips]}), /重复/);
  const badDate = sample(); badDate.trips[0].startDate = '2026-02-31';
  assert.throws(() => validateBook(badDate), /日期/);
});

test('legacy trips share one city wishlist without inferring visits from completion', () => {
  const book = sample();
  book.trips.push({...structuredClone(book.trips[0]),id:'second',city:'南京市',status:'completed'});
  const migrated = validateBook(book);
  assert.equal(migrated.cities.length,1);
  assert.equal(migrated.trips[0].cityId,migrated.trips[1].cityId);
  assert.equal(migrated.cities[0].places.length,1);
  assert.equal(migrated.cities[0].places[0].visited,false);
  assert.deepEqual(validateBook(migrated),migrated);
});

test('city wishlist, linked plans, cover and feeling survive save and backup', () => {
  const book = sample();
  book.cities = [{id:'city',name:'南京',places:[{id:'lake',name:'玄武湖',kind:'place',note:'日落',visited:false,sourceIds:['S01']}]}];
  Object.assign(book.trips[0],{cityId:'city',cover:{id:'cover',caption:'秋天'},feeling:'终于出发了'});
  book.trips[0].plan[0].placeId = 'lake';
  const saved = validateBook(book);
  assert.deepEqual(saved.cities,book.cities);
  assert.equal(saved.trips[0].plan[0].placeId,'lake');
  assert.equal(saved.trips[0].feeling,'终于出发了');
  assert.deepEqual([...referencedPhotos(saved)],['cover']);
  const png = btoa(String.fromCharCode(137,80,78,71,13,10,26,10));
  assert.equal(validateBackup({format:'slow-travel-backup',version:1,book:saved,photos:[{id:'cover',mime:'image/png',data:png}]}).book.trips[0].cover.id,'cover');
  const shared = presentShared(shareSnapshot(saved,'nanjing'),'token');
  assert.deepEqual(shared.cities,[]);
  assert.equal(shared.trips[0].cover.url,'/api/shared/token/photos/cover');
  assert.equal(shared.trips[0].feeling,'终于出发了');
  assert.deepEqual(shared.trips[0].plan,[]);
});

test('sharing selects only the named trip, scopes its photos and leaves original URLs intact', () => {
  const book = sample();
  book.trips.push({...book.trips[0], id:'private-trip'});
  book.sources.push({id:'private-source',title:'保密',archiveUrl:'',originalUrl:''});
  const photo = {id:'photo-1',url:'/api/photos/photo-1',caption:'湖'};
  book.trips[0].journal = [{id:'entry',day:1,place:'湖边',text:'傍晚',photos:[photo]}];
  const snapshot = shareSnapshot(book,'nanjing');
  assert.deepEqual(snapshot.trips.map(t=>t.id), ['nanjing']);
  assert.deepEqual(snapshot.sources, []);
  assert.deepEqual(snapshot.trips[0].candidates, []);
  assert.deepEqual(snapshot.trips[0].plan, []);
  assert.deepEqual([...referencedPhotos(snapshot)], ['photo-1']);
  assert.equal(presentShared(snapshot,'secret').trips[0].journal[0].photos[0].url, '/api/shared/secret/photos/photo-1');
  assert.equal(photo.url,'/api/photos/photo-1');
});

test('restore refuses missing photos and arbitrary html renamed as a photo', () => {
  const book = sample();
  book.trips[0].journal = [{id:'entry',day:1,place:'湖',text:'',photos:[{id:'lake',url:'/api/photos/lake',caption:''}]}];
  const payload = {format:'slow-travel-backup',version:1,book,photos:[]};
  assert.throws(() => validateBackup(payload), /照片/);
  assert.throws(() => validateBackup({...payload,photos:[{id:'lake',mime:'image/png',data:btoa('<script>')}]}), /图片|照片/);
});
