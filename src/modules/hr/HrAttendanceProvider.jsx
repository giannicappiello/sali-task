import {createContext,useContext} from 'react';
const Context=createContext(null);
const disabled={member:false,ready:true,open:null,status:'Presenza secondo orario dipendente',notice:'',refresh:async()=>null,setManualPending:()=>{}};
// eslint-disable-next-line react-refresh/only-export-components
export const useHrAttendance=()=>useContext(Context);
// Punches and GPS observation are disabled; presence is derived from employee schedules.
export default function HrAttendanceProvider({children}){return <Context.Provider value={disabled}>{children}</Context.Provider>;}
