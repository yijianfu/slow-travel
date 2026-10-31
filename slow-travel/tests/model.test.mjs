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
  assert.deepEqual(validateBook(book), book);
  assert.throws(() => validateBook({...book,trips:[...book.trips,...book.trips]}), /重复/);
  const badDate = sample(); badDate.trips[0].startDate = '2026-02-31';
  assert.throws(() => validateBook(badDate), /日期/);
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
