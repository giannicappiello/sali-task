// Gregorian Easter (Meeus/Jones/Butcher); dates are civil Italian calendar dates.
function easter(year) {
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4;
  const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30;
  const i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
  const month=Math.floor((h+l-7*m+114)/31),day=(h+l-7*m+114)%31+1;
  return new Date(Date.UTC(year,month-1,day));
}
export function italianHoliday(day) {
  const year=Number(day.slice(0,4));
  const fixed={'01-01':'Capodanno','01-06':'Epifania','04-25':'Liberazione','05-01':'Festa del lavoro','06-02':'Festa della Repubblica','08-15':'Assunzione','11-01':'Ognissanti','12-08':'Immacolata','12-25':'Natale','12-26':'Santo Stefano'};
  if(year>=2026) fixed['10-04']='San Francesco d’Assisi';
  if(fixed[day.slice(5)]) return fixed[day.slice(5)];
  const sunday=easter(year),monday=new Date(+sunday+86400000);
  if(day===sunday.toISOString().slice(0,10)) return 'Pasqua';
  if(day===monday.toISOString().slice(0,10)) return 'Lunedì dell’Angelo';
  return '';
}
export function calendarDay(day) {
  const weekday=new Date(`${day}T12:00:00Z`).getUTCDay();
  const holiday=italianHoliday(day);
  return {weekday,holiday,festive:weekday===0 || Boolean(holiday),saturday:weekday===6};
}
