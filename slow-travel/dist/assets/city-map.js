// These coordinates use the same geographic projection as china-map.svg.
function normalizedCityName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
    .replace(/^中国/, '').replace(/^.*省/, '')
    .replace(/(特别行政区|自治州|地区|盟|市)$/, '');
}
function cityLocation(value) {
  const name = normalizedCityName(value);
  const point = Object.hasOwn(CITY_COORDINATES, name) ? CITY_COORDINATES[name] : null;
  if (!point) return {key:name, position:null};
  const [id, latitude, longitude] = point;
  const x = (longitude - 68) / 72 * 100;
  const y = (56 - latitude) / 40 * 100;
  return {key:id, position:x >= 0 && x <= 100 && y >= 0 && y <= 100 ? {x,y} : null};
}
function citiesFromTrips(trips) {
  const cities = new Map();
  for (const trip of trips) {
    const location = cityLocation(trip.city);
    let city = cities.get(location.key);
    if (!city) {
      city = {...location, label:trip.city, status:trip.status, tripIds:[]};
      cities.set(location.key, city);
    }
    city.tripIds.push(trip.id);
    if (trip.status === 'completed' || trip.status === 'ongoing' && city.status !== 'completed') city.status = trip.status;
  }
  return [...cities.values()];
}
