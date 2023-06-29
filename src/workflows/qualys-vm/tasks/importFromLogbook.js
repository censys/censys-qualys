// importFromLogbook.js

module.exports = async function importFromLogbook(my) {
  const { argv, censys, qualysCloud, db } = my;

  let idFrom = argv.idFrom ? Number(argv.idFrom) : 0;
  let saved = await my.storage.get("lastId.json");
  idFrom = saved ? Number(saved.lastId) : idFrom;

  const addIps = argv.addIps ? argv.addIps : true;
  const excludeIps = argv.excludeIps ? argv.excludeIps : false;

  const trialMode = argv.trialMode ? argv.trialMode : false; //trialMode will truncate the list of IPs for testing on a trial version of Qualys

  if (Number.isNaN(idFrom)) {
    console.log(
      "Error: idFrom is not a number. Verify the lastId.json and settings.yaml contain a valid number value for idFrom."
    );
    return;
  }

  if (idFrom == 0) {
    // limit the filter type to HOST when downloading the entire logbook since this may be very large
    filter = { type: ["HOST"] };
  }

  let results = {};
  results = await censys.api.saas.getLogbookCursor({
    filter: {},
    idFrom: idFrom,
  });

  let cursor = results.data.cursor;
  let lb = await censys.api.saas.getLogbookData({ cursor: cursor });

  if (lb.success) {
    db.logbook.import(lb.data);

    // get the last id retrieved
    db.logbook.allRows();
    db.logbook.lastRow();
    let dbLastId = db.logbook.row["id"];

    // we want to get all associate and disassociate events 
    //
    // if we associate -> disassociate -> associate, we want to keep that IP in
    // the set 
    //
    // if we associate -> disassociate, we want to remove the IP from the set 
    // and add it to the exclude list
    //
    // this applies for any multiple of the above; i.e. assoc. -> disassoc. ->
    // assoc. -> disassoc. still results in removal from the set

    // get associated + disassociated
    let associated = new Set([]);
    let disassociated = new Set([]);
    await Promise.all([getLogbookEvents("HOST", "ASSOCIATE", dbLastId, my), getLogbookEvents("HOST", "DISASSOCIATE", dbLastId, my)]).then(
      (events) => {
        associated = events[0]
        disassociated = events[1]
      }
    )

    // find intersection of two sets - shows things that have been associated/disassociated and need a tiebreaker
    let candidates = intersection(associated.ips, disassociated.ips);
    // for each IP found in intersection, check time of most recent assoc/disassoc for that IP, most recent wins
    for (const ip of candidates.keys()) {
      if (associated.lookup[ip] > disassociated.lookup[ip]) {
        // if assoc: keep in IP, remove from exclude
        disassociated.ips.delete(ip);
      } else {
        // if disassoc: remove from IP, keep in exclude
        associated.ips.delete(ip)
      }
    }

    //truncate number of IPs for Qualys trial mode
    associated.ips = trialMode ? [...associated.ips].slice(0, 20) : [...associated.ips]; 
    // disassociated.ips = trialMode ? [...disassociated.ips].slice(0, 20) : [...disassociated.ips]; 

    // add IPs to Qualys and exclude list in parallel
    await Promise.all([
      doQualys(qualysCloud.addIps, "HOST", "ASSOCIATE", associated, my, trialMode), 
      doQualys(qualysCloud.excludeIps, "HOST", "DISASSOCIATE", disassociated, my, trialMode)
    ]).then(
      (result) => {
        if (result[0].success && result[1].success) {
          // update our local logbook cursor
          my.storage.put({ lastId: dbLastId + 1 }, "lastId.json", `tasks/${my.taskName}/input`);
        } else if (!result[0].success) {
          console.log(`Qualys API Error Adding IPs: ${result[0].response.body.toString()}`);
        } else if (!result[1].success) {
          console.log(`Qualys API Error Updating exclusion list: ${result[1].response.body.toString()}`);
        }
      }
    );
  }   
};

async function getLogbookEvents(type, operation, dbLastId, my) {
  my.db.logbook.where((row) => row.type == type && row.operation == operation);
  let { entity } = my.db.logbook.fullRowSetToArray({ entity: [] });
  let ips = entity.map((i) => i.entity.ipAddress);
  ips = new Set(ips);
  // find most recent event for each ip - add timestamp to lookup table
  let lookup = {};
  for (let i in entity) {
    let ip = entity[i].entity.ipAddress;
    let ts = Date.parse(entity[i].timestamp);
    if (lookup[ip] === undefined || ts > lookup[ip]) {
      lookup[ip] = ts;
    } 
  }

  return {'numEvents': my.db.logbook.rowSet.numOfRows(), 'lookup': lookup, 'ips': ips}
}

async function doQualys(qcAction, type, operation, events, my, trialMode = false) {
  if (events.ips.length > 0) {
    const qc = await qcAction(events.ips);

    if (qc.success) {
      // summarize results and output to console
      console.log();
      console.log(`Summary:${trialMode ? " *** TRIAL MODE" : ""}`);
      console.log("-------");
      console.log(`Total number of events: ${my.db.logbook.numOfRows()}`);
      console.log(`Number of ${type}, ${operation} events: ${events.numEvents}`);
      console.log(`Number of IPs shipped to Qualys VM instance: ${events.ips.length}`);
      console.log();
    }
    return qc;
  }
}
    

function intersection(setA, setB) {
  const _intersection = new Set();
  for (const elem of setB) {
    if (setA.has(elem)) {
      _intersection.add(elem);
    }
  }
  return _intersection;
}