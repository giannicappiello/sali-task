import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { productionOverviewAccess, productionOverviewKind } from '../lib/productionOverviewAccess';

export default function useProductionOverviewAccess() {
  const { profile, areaAccess = [], userDepartmentIds = [], dataScope, isAdminUser } = useAuth();
  const ids = [...new Set([profile?.reparto_id, ...userDepartmentIds].filter(Boolean))].sort().join(',');
  const [departments, setDepartments] = useState({ key: '', names: [] });
  useEffect(() => {
    let active = true;
    if (!ids) return;
    supabase.from('reparti').select('nome,attivo').in('id', ids.split(','))
      .then(({data, error}) => { if (active) setDepartments({key:ids,names:error?[]:(data||[]).filter(d=>d.attivo!==false).map(d=>d.nome)}); })
      .catch(() => { if (active) setDepartments({key:ids,names:[]}); });
    return () => { active = false; };
  }, [ids]);
  const rights = productionOverviewAccess({admin:isAdminUser,role:profile?.ruoli?.nome,areas:areaAccess,
    departments:departments.key===ids?departments.names:[],
    customer:profile?.attivo===false || /client|portal/i.test(profile?.ruoli?.nome||'') || Boolean(dataScope?.customerCode || dataScope?.customerCodes?.length)});
  const canOpen = useCallback(path => Boolean(rights[productionOverviewKind(path, window.location.origin)]), [rights.station, rights.filling]);
  return {canOpen, pending: Boolean(ids && departments.key!==ids)};
}
