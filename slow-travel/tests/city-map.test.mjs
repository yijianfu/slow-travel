import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

const context = createContext({});
for (const name of ['cities.js','city-map.js']) {
  runInContext(readFileSync(new URL('../dist/assets/' + name,import.meta.url),'utf8'),context);
}
const location = context.cityLocation;
const cities = context.citiesFromTrips;

test('new city records project to their own map positions', () => {
  const result = cities([
    {id:'nj',city:'南京',status:'planned'},
    {id:'sh',city:'上海',status:'completed'},
    {id:'bj',city:'北京',status:'planned'}
  ]);
  assert.equal(result.length,3);
  assert.ok(result.every(city => city.position));
  assert.ok(Math.abs(result[0].position.x - 70.525) < .01);
  assert.notEqual(result[0].position.x,result[1].position.x);
  assert.notEqual(result[0].position.y,result[2].position.y);
});
test('city spelling variants share one marker and preserve every trip', () => {
  const result = cities([
    {id:'one',city:'南京',status:'planned'},
    {id:'two',city:'江苏省南京市',status:'completed'},
    {id:'three',city:'Nanjing',status:'ongoing'}
  ]);
  assert.equal(result.length,1);
  assert.equal(result[0].tripIds.length,3);
  assert.equal(result[0].status,'completed');
});
test('renaming and deleting trips update the derived map without saved marker state', () => {
  const trips = [{id:'one',city:'南京',status:'planned'}];
  const oldKey = cities(trips)[0].key;
  trips[0].city = '杭州';
  assert.notEqual(cities(trips)[0].key,oldKey);
  trips.pop();
  assert.equal(cities(trips).length,0);
});
test('unknown places remain available without inventing a coordinate', () => {
  const result = cities([{id:'one',city:'一个尚未确定的地方',status:'planned'}]);
  assert.equal(result.length,1);
  assert.equal(result[0].position,null);
  assert.equal(location('__proto__').position,null);
});
test('common destinations and city homophones resolve separately', () => {
  for (const city of ['北京','上海','南京','杭州','苏州','宿州','成都','重庆','西安','长沙','黄山','广州','深圳','台北','香港']) {
    assert.ok(location(city).position,city);
  }
  assert.notEqual(location('苏州').key,location('宿州').key);
});
