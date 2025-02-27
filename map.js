// map.js
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

mapboxgl.accessToken = 'pk.eyJ1IjoiaWt1bWFyNTUiLCJhIjoiY203bWh6aDFpMDAyaTJpb25xbWVtZjMzNSJ9.lUgbRghZ4u1WXm7wvv17Iw';

const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/mapbox/streets-v12',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18
});


const stationFlow = d3.scaleQuantize()
  .domain([0, 1])
  .range([0, 0.5, 1]);



// A global time filter
let timeFilter = -1; // -1 means "any time"

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function filterTripsByTime(trips, timeFilter) {
  if (timeFilter === -1) return trips;
  return trips.filter((trip) => {
    const startedMinutes = minutesSinceMidnight(trip.started_at);
    const endedMinutes   = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(startedMinutes - timeFilter) <= 60 ||
      Math.abs(endedMinutes   - timeFilter) <= 60
    );
  });
}

function computeStationTraffic(stations, trips) {
  const departures = d3.rollup(trips, v => v.length, d => d.start_station_id);
  const arrivals   = d3.rollup(trips, v => v.length, d => d.end_station_id);

  return stations.map(station => {
    const id = station.short_name;  // Must match trip's start_station_id, end_station_id
    station.departures   = departures.get(id) ?? 0;
    station.arrivals     = arrivals.get(id)   ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// Helper to project station lon/lat to pixel coords
function getCoords(station) {
  const lng = +station.Long || +station.lon;
  const lat = +station.Lat  || +station.lat;
  const point = map.project([lng, lat]);  // returns { x, y }
  return { cx: point.x, cy: point.y };
}

map.on('load', async () => {
  // 1) Load station data
  const stationUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
  let stations = (await d3.json(stationUrl)).data.stations;

  // 2) Load trips, parsing the date strings
  const trafficUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';
  const trips = await d3.csv(trafficUrl, trip => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at   = new Date(trip.ended_at);
    return trip;
  });
  console.log('Trips loaded:', trips.length);

  // 3) Compute station traffic for the FULL dataset initially
  stations = computeStationTraffic(stations, trips);

  // 4) Build a sqrt scale
  const radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(stations, d => d.totalTraffic)])
    .range([0, 25]);

  // 5) Create circles
  const svg = d3.select('#map').select('svg');
  let circles = svg.selectAll('circle')
    .data(stations, d => d.short_name) // use short_name as the key
    .join('circle')
      .attr('fill', 'steelblue')
      .attr('stroke', 'white')
      .attr('fill-opacity', 0.6)
      .attr('stroke-width', 1)
      .attr('r', d => radiusScale(d.totalTraffic))
      .each(function(d) {
        d3.select(this)
          .append('title')
          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
      });

  // 6) Re-position circles on map moves
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  map.on('move',   updatePositions);
  map.on('zoom',   updatePositions);
  map.on('resize', updatePositions);
  updatePositions();

  // 7) Update scatter plot after time-based filtering
  function updateScatterPlot(timeFilter) {
    // A) Filter trips
    const filteredTrips = filterTripsByTime(trips, timeFilter);
    // B) Recompute arrivals/departures
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // C) Possibly widen circle range if filtering
    if (timeFilter === -1) {
      radiusScale.range([0, 25]);
    } else {
      radiusScale.range([3, 50]);
    }

    // D) Re-bind data
    circles = circles
      .data(filteredStations, d => d.short_name)
      .join(
        enter => enter.append('circle')
          .attr('fill', 'steelblue')
          .attr('stroke', 'white')
          .attr('fill-opacity', 0.6)
          .attr('stroke-width', 1)
          .each(function(d) {
            d3.select(this).append('title');
          }),
        update => update,
        exit => exit.remove()
      )
      .attr('r', d => radiusScale(d.totalTraffic))
      .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic));

    // Update tooltips
    circles.select('title')
      .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

    // E) Re-position
    updatePositions();
  }

  // 8) Time slider logic
  const timeSlider   = document.getElementById('time-slider');
  const selectedTime = document.getElementById('selected-time');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value);
    if (timeFilter === -1) {
      selectedTime.textContent = '';
      anyTimeLabel.style.display = 'block';
    } else {
      selectedTime.textContent = formatTime(timeFilter);
      anyTimeLabel.style.display = 'none';
    }
    // Now update the circles
    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay(); // initialize
});
