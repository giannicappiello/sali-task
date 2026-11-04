import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {transformSync} from 'rolldown/experimental';

const source=readFileSync(new URL('../src/pages/Warehouse/OrderPreparation.jsx',import.meta.url),'utf8');
const action=source.indexOf('void perform("verify");');
const start=source.lastIndexOf('{editable &&',action);
const end=source.indexOf('\n            )}',action)+'\n            )}'.length;
assert.ok(start>=0 && end>start,'Riscontro button exists');
const editableExpression=source.match(/const editable =\s*([\s\S]*?);/)[1];
const button=source.slice(start,end);
const result=transformSync('VerifyButton.jsx',`function render(row,canWrite,busy,scans,setCamera,perform){const editable=${editableExpression};return (<div>${button}</div>);}`,{jsx:{runtime:'classic'}});
assert.equal(result.errors?.length || 0,0);
const render=new Function('React',result.code+';return render;')(React);
function fixture({status='verified',canWrite=true,busy=false,scans=[{id:'scan'}]}={}) {
  const state={camera:true,calls:[]};
  const row={status,verification:{ok:true,summary:{weightTotals:{grossKg:10}}},state:{scans,packages:[{id:'box'}],pallets:[{id:'pallet'}]}};
  const element=render(row,canWrite,busy,scans,value=>{state.camera=value;},operation=>{state.calls.push(operation);});
  return {state,row,button:element.props.children};
}

test('a previously verified preparation exposes Ripeti riscontro and invokes verify without altering its contents',()=>{
  const f=fixture();const before=structuredClone(f.row);
  assert.equal(f.button.type,'button');assert.equal(f.button.props.children,'Ripeti riscontro');
  assert.equal(f.button.props.disabled,false);
  f.button.props.onClick();
  assert.deepEqual(f.state.calls,['verify']);assert.equal(f.state.camera,false);
  assert.deepEqual(f.row,before);
});

test('a draft preparation retains the initial Riscontra action',()=>{
  const f=fixture({status:'draft'});
  assert.equal(f.button.props.children,'Riscontra');assert.equal(f.button.props.disabled,false);
});

test('read-only and non-editable preparations cannot repeat verification',()=>{
  for(const status of ['exporting','uncertain','completed','cancelled'])assert.equal(fixture({status}).button,false,status);
  assert.equal(fixture({canWrite:false}).button,false);
});

test('verification stays disabled during another operation or without scans',()=>{
  assert.equal(fixture({busy:true}).button.props.disabled,true);
  assert.equal(fixture({scans:[]}).button.props.disabled,true);
});

