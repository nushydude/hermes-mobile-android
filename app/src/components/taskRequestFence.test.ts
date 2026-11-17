import { expect, it } from 'vitest';
import { TaskRequestFence, TaskRequestFences } from './taskRequestFence';
it('ignores a result for the previous selection or closed scope',()=>{
  const fence=new TaskRequestFence(), a=fence.begin(), b=fence.begin();
  expect(fence.valid(a)).toBe(false);
  expect(fence.valid(b)).toBe(true);
  fence.invalidate();
  expect(fence.valid(b)).toBe(false);
});
it('keeps an in-flight result valid when a list refresh starts',()=>{
  const requests=new TaskRequestFences();
  const selected=requests.result.begin();
  requests.refresh.begin();
  expect(requests.result.valid(selected)).toBe(true);
  requests.invalidate();
  expect(requests.result.valid(selected)).toBe(false);
});
