import {useEffect,useRef,useState} from 'react';

export default function OrdersTableScrollbar(){
 const bar=useRef(null),target=useRef(null);
 const [size,setSize]=useState(null);
 useEffect(()=>{
  const root=bar.current?.closest('.orders-module');
  if(!root)return;
  let frame=0;
  const measure=()=>{
   frame=0;
   const candidates=Array.from(root.querySelectorAll('table')).map(table=>{
    let container=table.parentElement;
    while(container&&container!==root&&!/(auto|scroll)/.test(getComputedStyle(container).overflowX))container=container.parentElement;
    const rect=table.getBoundingClientRect();
    return {table,container,rect,visible:Math.max(0,Math.min(rect.bottom,innerHeight)-Math.max(rect.top,0))};
   }).filter(item=>item.container&&item.container!==root&&item.visible>0&&item.rect.width>0).sort((a,b)=>b.visible-a.visible);
   const current=candidates[0];target.current=current?.container||null;
   if(!current){setSize(null);return;}
   const rect=current.container.getBoundingClientRect();
   const left=Math.max(8,rect.left),width=Math.max(0,Math.min(innerWidth-8,rect.right)-left);
   setSize(previous=>previous?.left===left&&previous?.width===width&&previous?.content===current.container.scrollWidth?previous:{left,width,content:current.container.scrollWidth});
   if(bar.current&&Math.abs(bar.current.scrollLeft-current.container.scrollLeft)>1)bar.current.scrollLeft=current.container.scrollLeft;
  };
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const resize=new ResizeObserver(schedule);resize.observe(root);
  const mutations=new MutationObserver(schedule);mutations.observe(root,{childList:true,subtree:true});
  window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);schedule();
  return()=>{cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);};
 },[]);
 return <div ref={bar} className="orders-fixed-scrollbar" role="region" aria-label="Scorrimento orizzontale tabella" tabIndex={0} style={size?{left:size.left,width:size.width}:{visibility:'hidden'}} onScroll={e=>{if(target.current)target.current.scrollLeft=e.currentTarget.scrollLeft;}}><div style={{width:size?.content||0,height:1}}/></div>;
}
