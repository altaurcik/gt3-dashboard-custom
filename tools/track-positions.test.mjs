import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCircuitPath, circuitCalibration, sectorDistance, metres, TimingPositions, completedSectorSegments } from "../public/track-positions.js";

const car = (extra = {}) => ({ number: "71", progress: 3, laps: 10, sectorLapNumber: 10, totalTime: "16:40.000",
  sectors: ["30.000", "40.000", "50.000"].map((time) => ({ time })), status: 2, inPit: false, ...extra });
const snapshot = (rows, session = {}) => ({ raceAvailable: true, session: { id: "race", state: 1, complete: false, flag: "GREEN", ...session }, rows });
const lapDistance = 9 * circuitCalibration.length;

test("timing sectors map to official unequal distances, invalid input stays absent", () => {
  assert.equal(sectorDistance(0), 0); assert.equal(sectorDistance(1), 1616.4);
  assert.equal(sectorDistance(2), 2977.2); assert.equal(sectorDistance(3), 4653);
  assert.equal(sectorDistance(1.5), 2296.8);
  for (const input of [null, NaN, -1, 4, "1"]) assert.equal(sectorDistance(input), null);
});
test("real Portimao geometry is anchored at the timing finish, proceeds toward T1, and wraps on the same line", async () => {
  const geometry = JSON.parse(await readFile(new URL("../public/assets/portimao.geojson", import.meta.url)));
  const path = buildCircuitPath(geometry.features[0].geometry.coordinates);
  assert.ok(path.finishError < 2); assert.ok(Math.abs(path.length - 4653) < 5);
  assert.ok(metres(path.pointAt(0), circuitCalibration.finish) < 2);
  assert.ok(metres(path.pointAt(268), circuitCalibration.start) < 2);
  assert.ok(path.pointAt(20)[1] > path.pointAt(0)[1]);
  assert.ok(metres(path.pointAt(0), path.pointAt(4653)) < .001);
  assert.ok(metres(path.pointAt(10), path.pointAt(4663)) < .001);
});
test("completed sectors use actual per-sector durations on the cumulative race clock", () => {
  const segments = completedSectorSegments(car());
  assert.deepEqual(segments.map(({start,end}) => [start,end]), [[880000,910000],[910000,950000],[950000,1000000]]);
  assert.equal(segments[0].from, lapDistance);
  assert.equal(segments[2].to, lapDistance + 4653);
  const partial = car({ sectorLapNumber: 11, sectors: [{time:"32.123"}, {time:""}, {time:"50.000"}] });
  assert.deepEqual(completedSectorSegments(partial).map(({start,end})=>[start,end]), [[1000000,1032123]]);
  assert.deepEqual(completedSectorSegments(car({sectorLapNumber:9})), []);
  assert.deepEqual(completedSectorSegments(car({totalTime:null})), []);
  assert.deepEqual(completedSectorSegments(car({sectors:[{time:"30.000"}]})), []);
});
test("sector replay moves over a measured sector duration even with no progress updates", () => {
  const positions = new TimingPositions(); positions.update(snapshot([car()]), 0);
  const first = positions.positions(0)[0].distance;
  // A 50-second longest sector plus 8 seconds delivery buffer starts at race t=942.
  assert.ok(Math.abs(first - (lapDistance + 1616.4 + .8 * (2977.2 - 1616.4))) < .001);
  assert.equal(positions.delaySeconds(0), 58);
  assert.equal(positions.positions(8000)[0].distance, lapDistance + 2977.2);
  const halfS3 = positions.positions(33000)[0].distance;
  assert.equal(halfS3, lapDistance + (2977.2 + 4653) / 2);
  assert.equal(positions.positions(58000)[0].distance, lapDistance + 4653);
});
test("a long pre-race wait does not start the replay clock or accumulate map delay", () => {
  const positions=new TimingPositions();
  positions.update(snapshot([car({laps:0,sectorLapNumber:0,totalTime:"0.000",sectors:[]})],{state:0}),0);
  assert.equal(positions.clock,null);assert.deepEqual(positions.positions(600000),[]);
  positions.update(snapshot([car()]),600000);
  assert.equal(positions.delaySeconds(600000),58);
  assert.equal(positions.positions(600000)[0].replaying,true);
});
test("unequal sectors and the finish join continuously across sparse sector-only packets", () => {
  const positions = new TimingPositions(); positions.update(snapshot([car()]), 0);
  let previous = positions.positions(0)[0].distance;
  for (let second=1; second<=175; second++) {
    if (second===30 || second===70) positions.update(snapshot([car({progress:second===30?1:2, sectorLapNumber:11,
      sectors:second===30?[{time:"30.000"}]:[{time:"30.000"},{time:"40.000"}]})]), second*1000);
    if (second===120) positions.update(snapshot([car({laps:11,sectorLapNumber:11,totalTime:"18:40.000"})]),second*1000);
    if (second===150) positions.update(snapshot([car({laps:11,sectorLapNumber:12,totalTime:"18:40.000",progress:1,sectors:[{time:"30.000"}]})]),second*1000);
    const point=positions.positions(second*1000)[0];
    assert.equal(point.replaying,true,`buffer at t=${second}`);
    assert.ok(point.distance>previous,`stopped or reversed at t=${second}`);
    assert.ok(point.distance-previous<60,`jump at t=${second}`);
    previous=point.distance;
  }
  assert.ok(previous>10*4653);
});
test("all cars share one replay clock so differing sector durations do not shift their relative timing", () => {
  const positions = new TimingPositions();
  positions.update(snapshot([car(),car({number:"77",totalTime:"16:45.000"})]),0);
  const points=positions.positions(13000);
  const a=points.find(p=>p.row.number==="71"),b=points.find(p=>p.row.number==="77");
  assert.ok(a.distance>b.distance);
  assert.ok(Math.abs(a.distance-b.distance-(4653-2977.2)*5/50)<.001);
});
test("repeated packets preserve the playhead; corrections replace segments instead of adding laps", () => {
  const positions = new TimingPositions(); positions.update(snapshot([car()]),0);
  const before=positions.positions(4000)[0].distance;
  positions.update(snapshot([car()]),4000);
  assert.equal(positions.positions(4000)[0].distance,before);
  assert.ok(positions.positions(5000)[0].distance>before);
  positions.update(snapshot([car({sectors:[{time:"31.000"},{time:"39.000"},{time:"50.000"}]})]),6000);
  assert.equal(positions.cars.get("71").segments.length,3);
});
test("pause, stale and red stop playback; reduced motion and completed races remain static", () => {
  const positions = new TimingPositions(); positions.update(snapshot([car()]),0);
  positions.freeze(4000); const frozen=positions.positions(4000)[0].distance;
  assert.equal(positions.positions(20000)[0].distance,frozen);
  positions.update(snapshot([car()]),20000,{fresh:false});
  assert.equal(positions.positions(30000)[0].distance,frozen);
  positions.update(snapshot([car()],{flag:"RED"}),30000);
  assert.equal(positions.positions(31000)[0].distance,positions.positions(40000)[0].distance);
  for (const options of [{reduced:true},{}]) {
    const s=snapshot([car()],options.reduced?{}:{complete:true,state:2});
    positions.update(s,40000,options);
    assert.equal(positions.positions(45000)[0].distance,4653);
    assert.equal(positions.positions(50000)[0].distance,4653);
  }
});
test("missing endpoints never generate an unconfirmed sector or another lap", () => {
  const positions=new TimingPositions();positions.update(snapshot([car()]),0);
  positions.positions(8000);
  const exhausted=positions.positions(90000)[0];
  assert.equal(exhausted.distance,10*4653);assert.equal(exhausted.replaying,false);
  assert.equal(positions.positions(900000)[0].distance,exhausted.distance);
  positions.update(snapshot([car()]),900001);
  assert.equal(positions.positions(900002)[0].distance,exhausted.distance);
  const empty=new TimingPositions();empty.update(snapshot([car({sectors:[]})]),0);
  assert.equal(empty.positions(1000)[0].distance,4653);
  assert.equal(empty.positions(1000)[0].replaying,false);
});
test("opening mid-sector keeps every eligible car visible while the replay buffer fills", () => {
  const positions=new TimingPositions();
  const row=car({laps:3,sectorLapNumber:4,totalTime:"5:16.383",progress:.9897912796707509,sectors:[{time:"32.651"}]});
  positions.update(snapshot([row]),0);
  const initial=positions.positions(0)[0];
  assert.equal(initial.row.number,"71");assert.equal(initial.replaying,false);
  assert.equal(initial.distance,sectorDistance(row.progress));
  const begun=positions.positions(8001)[0];
  assert.equal(begun.replaying,true);
  assert.ok(positions.positions(10000)[0].distance>begun.distance);
});
test("a formation-lap buffer shrinks when racing sectors replace it", () => {
  const positions=new TimingPositions();
  positions.update(snapshot([car({sectors:[{time:"3:30.000"},{time:"40.000"},{time:"50.000"}]})]),0);
  assert.equal(positions.delaySeconds(0),218);
  positions.update(snapshot([car({laps:11,sectorLapNumber:11,totalTime:"18:40.000"})]),120000);
  assert.equal(positions.delaySeconds(120000),58);
  assert.equal(positions.positions(120000)[0].replaying,true);
});
test("one pit-delayed outlier does not hold up the field; a sector interval is not prematurely stale", () => {
  const positions=new TimingPositions();
  const rows=Array.from({length:30},(_,i)=>car({number:String(i+1)}));
  rows.push(car({number:"46",sectors:[{time:"3:30.000"},{time:"40.000"},{time:"50.000"}]}));
  positions.update(snapshot(rows),0);
  assert.equal(positions.delaySeconds(0),58);
  assert.ok(positions.freshnessMs()>50000);assert.ok(positions.freshnessMs()<=120000);
});
test("a TV Sync seek within the same lap drops sector endpoints from the future", () => {
  const positions=new TimingPositions();
  const current=car({sectorLapNumber:11,progress:2,sectors:[{time:"30.000"},{time:"40.000"}]});
  positions.update(snapshot([current]),0);
  positions.positions(5000);
  positions.update(snapshot([{...current,progress:1,sectors:[{time:"30.000"}]}]),6000);
  assert.equal(positions.cars.get("71").segments.length,1);
  assert.ok(positions.playhead<1030000);
});
test("pit, retired, unknown progress, session changes and seeking discard unrelated trajectories", () => {
  const positions=new TimingPositions();positions.update(snapshot([car()]),0);
  for(const extra of [{inPit:true},{inPit:null},{status:4},{status:8},{status:16},{progress:null}]) {
    positions.update(snapshot([car(extra)]),1000);assert.equal(positions.cars.size,0);
  }
  positions.update(snapshot([car()]),2000);
  positions.update(snapshot([car({laps:9,sectorLapNumber:9,totalTime:"14:40.000"})]),3000);
  assert.equal(positions.cars.get("71").segments.length,3);
  assert.ok(positions.positions(3000)[0].distance<9*4653);
  positions.update(snapshot([],{id:"other"}),4000);assert.equal(positions.cars.size,0);
  positions.update(null,5000);assert.equal(positions.session,null);
});
