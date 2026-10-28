import {postEventOrderValue} from './crmBeautyData.js';

export function scopeBeautyOrders(data, orderIds) {
  const allowed = new Set(orderIds);
  return {...data, events: (data.events || []).map(event => {
    const orders = (event.impact?.orders || []).filter(order => allowed.has(order.id));
    const scoped = {...event, impact: {...event.impact, orders}};
    return {...scoped, impact: {...scoped.impact, order_value: postEventOrderValue([scoped])}};
  })};
}
