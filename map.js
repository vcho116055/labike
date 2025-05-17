import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";

mapboxgl.accessToken =
  "pk.eyJ1IjoidmNobzExNjA1NSIsImEiOiJjbWFyczU2YjIwOHR0Mm1xOHdoMng1MXVmIn0.VYe_HUKS4iRk1VeSM00w6A";

const DATA = {
  lanes: {
    boston:
      "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
    cambridge:
      "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  },
  stations: "https://dsc106.com/labs/lab07/data/bluebikes-stations.json",
  trips: "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv",
};

const radiusScale = d3.scaleSqrt().range([0, 25]);
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09, 42.36],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

const svg = d3.select("#map").select("svg");

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute = Array.from({ length: 1440 }, () => []);

let stations = [];
let circlesSelection;
let timeFilter = -1;

const timeSlider = document.getElementById("time-slider");
const selectedTime = document.getElementById("selected-time");
const anyTimeLabel = document.getElementById("any-time");

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function updateTimeDisplay() {
  timeFilter = Number(timeSlider.value);
  if (timeFilter === -1) {
    selectedTime.textContent = "";
    anyTimeLabel.style.display = "block";
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = "none";
  }
  updateScatterPlot(timeFilter);
}

timeSlider.addEventListener("input", updateTimeDisplay);
updateTimeDisplay();

function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  const minMinute = (minute - 60 + 1440) % 1440;
  const maxMinute = (minute + 60) % 1440;
  if (minMinute > maxMinute) {
    return tripsByMinute
      .slice(minMinute)
      .concat(tripsByMinute.slice(0, maxMinute))
      .flat();
  }
  return tripsByMinute.slice(minMinute, maxMinute).flat();
}

function computeStationTraffic(stationsInput, minute = -1) {
  const depRoll = d3.rollup(
    filterByMinute(departuresByMinute, minute),
    (v) => v.length,
    (d) => d.start_station_id
  );
  const arrRoll = d3.rollup(
    filterByMinute(arrivalsByMinute, minute),
    (v) => v.length,
    (d) => d.end_station_id
  );
  return stationsInput.map((s) => {
    const id = s.short_name;
    s.departures = depRoll.get(id) ?? 0;
    s.arrivals = arrRoll.get(id) ?? 0;
    s.totalTraffic = s.departures + s.arrivals;
    return s;
  });
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function updatePositions() {
  circlesSelection
    .attr("cx", (d) => getCoords(d).cx)
    .attr("cy", (d) => getCoords(d).cy);
}

function updateScatterPlot(minute) {
  const filteredStations = computeStationTraffic(stations, minute);
  radiusScale.range(minute === -1 ? [0, 25] : [3, 50]);
  radiusScale.domain([0, d3.max(filteredStations, (d) => d.totalTraffic)]);
  circlesSelection = svg
    .selectAll("circle")
    .data(filteredStations, (d) => d.short_name)
    .join("circle")
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .each(function (d) {
      d3.select(this)
        .selectAll("title")
        .data([d])
        .join("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    })
    .style("--departure-ratio", (d) =>
      stationFlow(d.departures / (d.totalTraffic || 1))
    );
  updatePositions();
}

map.on("load", async () => {
  map.addSource("boston_lanes", { type: "geojson", data: DATA.lanes.boston });
  map.addLayer({
    id: "boston-bike-lanes",
    type: "line",
    source: "boston_lanes",
    paint: { "line-color": "#32D400", "line-width": 3, "line-opacity": 0.4 },
  });

  map.addSource("cambridge_lanes", {
    type: "geojson",
    data: DATA.lanes.cambridge,
  });
  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_lanes",
    paint: { "line-color": "#32D400", "line-width": 3, "line-opacity": 0.4 },
  });

  const jsonData = await d3.json(DATA.stations);
  stations = jsonData.data.stations
    .map((s) => ({
      ...s,
      lat: +s.lat,
      lon: +s.lon,
      departures: 0,
      arrivals: 0,
      totalTraffic: 0,
    }))
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));

  const trips = await d3.csv(DATA.trips, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  trips.forEach((trip) => {
    const startMin = minutesSinceMidnight(trip.started_at);
    const endMin = minutesSinceMidnight(trip.ended_at);
    departuresByMinute[startMin].push(trip);
    arrivalsByMinute[endMin].push(trip);
  });

  updateScatterPlot(-1);

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);
});
