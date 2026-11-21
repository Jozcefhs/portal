(() => {
  'use strict';
  const statuses = ['Waiting','In progress','Completed','Cancelled'];

  function summarize(visits) {
    const departments = new Map(), patients = new Set();
    let attendance = 0, cancelled = 0, other = 0, missingPatient = 0;
    for (const visit of visits) {
      const name = visit.department.trim().replace(/\s+/g,' ') || 'Unassigned';
      const key = name.toLowerCase();
      if (!departments.has(key)) departments.set(key,{name, counts:[0,0,0,0,0]});
      const index = statuses.indexOf(visit.status);
      departments.get(key).counts[index < 0 ? 4 : index]++;
      if (index < 0) other++;
      else if (visit.status === 'Cancelled') cancelled++;
      else {
        attendance++;
        if (visit.patient) patients.add(visit.patient);
        else missingPatient++;
      }
    }
    return {attendance,cancelled,other,missingPatient,patients:patients.size,
      departments:[...departments.values()].sort((a,b)=>a.name.localeCompare(b.name))};
  }

  function create({$,esc,print}) {
    const visits = new Map(), panel = $('visitAttendance');
    let period = null, partial = false, changed = false;
    function clearPrint(){
      const target=$('cardPrint');
      if(target.firstElementChild?.dataset.attendancePrint)target.replaceChildren();
    }
    function draw(){
      if(!panel.open)return;
      $('attendancePrint').hidden=!period;
      $('attendanceRest').hidden=!period || !partial;
      const body=$('attendanceBody');
      if(!period){body.textContent='Choose dates and load visits to view attendance.';return;}
      const {attendance,patients,cancelled,other,missingPatient,departments}=summarize(visits.values());
      const qualifier=partial?'Partial report':'Full selected period';
      const rows=departments.map(d=>`<tr><th scope="row">${esc(d.name)}</th>${d.counts.slice(0,other?5:4).map(n=>`<td>${n}</td>`).join('')}</tr>`).join('');
      body.innerHTML=`<p><strong>${qualifier}</strong> · ${esc(period.branch)} · ${esc(period.fromDate)} to ${esc(period.toDate)} (WAT)</p>
        <p><strong>${attendance}</strong> attended visit${attendance===1?'':'s'} · <strong>${patients}</strong> distinct patient${patients===1?'':'s'} · <strong>${cancelled}</strong> cancelled visit${cancelled===1?'':'s'}</p>
        <p class="hint">Based on ${visits.size} loaded reception visit${visits.size===1?'':'s'} by arrival date (WAT). Unidentified arrivals enter this report through a linked reception visit. Waiting, in-progress and completed visits count as attendance.${partial?' More visits are available.':''}${changed?' Visit activity changed after loading. Use Load visits to refresh.':''}${missingPatient?' Missing patient IDs in attended visits: '+missingPatient+'.':''}</p>
        ${rows?`<div class="table-wrap"><table><caption>Visits by department</caption><thead><tr><th scope="col">Department</th>${[...statuses,...(other?['Other status']:[])].map(s=>`<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`:''}`;
    }
    panel.ontoggle=draw;
    $('attendancePrint').onclick=()=>{
      if(!period)return;
      draw();
      const copy=document.createElement('div');
      copy.dataset.attendancePrint='true';
      const heading=document.createElement('h2');heading.textContent='Patient attendance';
      copy.append(heading,...$('attendanceBody').cloneNode(true).childNodes);
      const target=$('cardPrint');target.classList.add('billing-print');target.replaceChildren(copy);
      print();
    };
    window.addEventListener('afterprint',clearPrint);
    return {
      clear(){
        clearPrint();visits.clear();period=null;partial=false;changed=false;
        $('attendanceBody').replaceChildren();$('attendanceRest').hidden=$('attendancePrint').hidden=true;draw();
      },
      markChanged(visitId){
        if(period && (!visitId || visits.has(visitId))){changed=true;draw();}
      },
      add(rows,range,next){
        period=range;partial=Boolean(next);
        for(const row of rows)visits.set(row.VisitId,{department:String(row.Department||''),status:row.Status,patient:row.PatientId});
      },
      draw
    };
  }
  window.DynamaxHospitalAttendance={create,summarize};
})();
