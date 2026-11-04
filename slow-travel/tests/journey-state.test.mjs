import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});
vm.runInContext(readFileSync(new URL('../dist/assets/city-pages.js',import.meta.url),'utf8'),context);

test('removing the last linked check-in restores a wishlist entry, while other visits preserve it',()=>{
  const draft={cities:[{id:'c',places:[{id:'p',visited:true},{id:'other',visited:true}]}],trips:[
    {id:'first',cityId:'c',plan:[]},{id:'second',cityId:'c',plan:[{id:'plan',placeId:'p',done:true}]}
  ]};
  context.syncCityVisits(draft,'c',['p']);
  assert.equal(draft.cities[0].places[0].visited,true);
  draft.trips.pop();
  context.syncCityVisits(draft,'c',['p']);
  assert.equal(draft.cities[0].places[0].visited,false);
  assert.equal(draft.cities[0].places[1].visited,true);
});
