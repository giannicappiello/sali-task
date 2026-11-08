const numeric=value=>value!==null&&value!==undefined&&value!==""&&Number.isFinite(Number(value))?Number(value):null;

// Formula hours are productive hours: one formula shift is eight hours. Never
// use elapsed machine time, actual shifts or a current machine's opening hours.
export function formulaObjectiveBasis(evidence,machineId) {
 const frozen=evidence.baseline?.plannedTiming;
 const timing=frozen||evidence.plannedTimingRecovery?.timing||evidence.plannedTiming;
 const hours=numeric(timing?.productionHours),minutes=numeric(timing?.phaseMinutes);
 const formulaVersionId=numeric(timing?.formulaVersionId);
 const rows=(timing?.operations||[]).filter(r=>r.type==="Production"&&Number(r.impiantoId)===Number(machineId));
 const lots=rows.length===1?numeric(rows[0].lotCount):null;
 const perLot=hours>0?hours/8:minutes>0?minutes/480:null;
 const turns=formulaVersionId>0&&perLot>0&&Number.isSafeInteger(lots)&&lots>0?perLot*lots:null;
 return {turns,formulaVersionId,source:frozen?"frozen_formula":"linked_formula_reconstruction",historical: Boolean(frozen)&&turns!==null};
}

export function stationObjective(record) {
 const phases=(record.phases||[]).filter(p=>p.phase==="Semilavorato");
 const valid=phases.length>0&&new Set(phases.map(p=>p.machineId)).size===1;
 const basis=valid?formulaObjectiveBasis(record,phases[0].machineId):null;
 const objective=numeric(record.plannedObjective);
 return {formulaPlannedTurns:basis?.turns??null,
  plannedObjectivePerTurn:objective!==null&&objective>=0&&basis?.turns>0?objective/basis.turns:null,
  objectiveBasis:basis,
  objectiveWarning:!valid?"Obiettivo per turno non attribuibile a una singola STATION.":basis?.turns==null?"Obiettivo per turno non disponibile: revisione formula, durata o numero lotti mancanti/non validi.":basis.historical?null:"Obiettivo per turno ricostruito dai parametri disponibili; non è una durata storica congelata."};
}
