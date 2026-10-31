import type {PageObject} from './types';
import {objectBounds, translateObject} from './geometry';

/** Objects that can be copied, pasted and duplicated: shapes, drawings, text boxes, images, stamps,
 * signatures and highlights. Comment notes keep their thread and author, so they are not cloned. */
export const copyable = (o:PageObject) => o.kind !== 'note';

/** Copies of `objects` with new ids, on `page`, shifted by `offset` points (down and right). When the
 * target page is smaller, the group is pulled back inside it so nothing lands off the page. */
export function cloneObjects(objects:PageObject[], page:string, offset:number, newId:()=>string, pageSize?:{width:number;height:number}):PageObject[] {
 const items = objects.filter(copyable);
 if (!items.length) return [];
 const boxes = items.map(objectBounds), right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
 let dx = offset, dy = offset;
 if (pageSize) {
  dx -= Math.max(0, right + dx - pageSize.width); dy -= Math.max(0, bottom + dy - pageSize.height);
  dx += Math.max(0, -(Math.min(...boxes.map(b => b.x)) + dx)); dy += Math.max(0, -(Math.min(...boxes.map(b => b.y)) + dy));
 }
 return items.map(o => ({...translateObject(structuredClone(o), dx, dy), id: newId(), page}));
}
