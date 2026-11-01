do $$
declare c uuid:='77777777-7777-4777-8777-777777777777';v uuid;rejected boolean;
begin
 insert into second_brain_connections(id,user_id,auth_user_id,client_id,session_sealed,session_expires_at)
 values(c,'35cc0e58-9bad-48a4-9980-0904dd63fc7b','88888888-8888-4888-8888-888888888888','fixture-client','fixture-not-a-real-session',now()+interval '1 hour');
 insert into second_brain_oauth_codes(hash,connection_id,challenge,redirect_uri,resource)
 values('fixture-code',c,'fixture-challenge','http://127.0.0.1:12345/callback','https://workspace.progre.it/api/second-brain/mcp');
 rejected:=false;
 begin perform second_brain_exchange_oauth('authorization_code','fixture-code','fixture-client','http://127.0.0.1:12345/callback','wrong','https://workspace.progre.it/api/second-brain/mcp','a0','r0');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Wrong PKCE accepted';end if;
 select second_brain_exchange_oauth('authorization_code','fixture-code','fixture-client','http://127.0.0.1:12345/callback','fixture-challenge','https://workspace.progre.it/api/second-brain/mcp','a1','r1') into v;
 if v<>c then raise exception 'Wrong connection';end if;
 rejected:=false;
 begin perform second_brain_exchange_oauth('authorization_code','fixture-code','fixture-client','http://127.0.0.1:12345/callback','fixture-challenge','https://workspace.progre.it/api/second-brain/mcp','a2','r2');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Authorization code replay accepted';end if;
 perform second_brain_exchange_oauth('refresh_token','r1','fixture-client','','','https://workspace.progre.it/api/second-brain/mcp','a3','r3');
 rejected:=false;
 begin perform second_brain_exchange_oauth('refresh_token','r1','fixture-client','','','https://workspace.progre.it/api/second-brain/mcp','a4','r4');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Refresh replay accepted';end if;
 update second_brain_connections set revoked_at=now() where id=c;
 rejected:=false;
 begin perform second_brain_exchange_oauth('refresh_token','r3','fixture-client','','','https://workspace.progre.it/api/second-brain/mcp','a5','r5');exception when others then rejected:=true;end;
 if not rejected then raise exception 'Revoked connection accepted';end if;
end;$$;
set local role authenticated;
do $$declare denied boolean:=false;begin
 begin perform 1 from second_brain_connections;exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Authenticated role can read encrypted sessions';end if;
 denied:=false;
 begin perform second_brain_exchange_oauth('refresh_token','r3','fixture-client','','','https://workspace.progre.it/api/second-brain/mcp','a6','r6');exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Authenticated role can mint OAuth tokens';end if;
end;$$;
reset role;
