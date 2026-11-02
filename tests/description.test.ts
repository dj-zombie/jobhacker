import { describe, expect, it } from 'vitest';
import { parseDescription } from '../src/components/jobhacker/description.js';

describe('parseDescription', () => {
  it('joins a single newline in the middle of a sentence', () => {
    const blocks = parseDescription('Ship the end of\nthe sentence today.');
    expect(blocks).toEqual([{ type: 'paragraph', text: 'Ship the end of the sentence today.' }]);
  });

  it('keeps a short label above a list as a heading', () => {
    const blocks = parseDescription('Requirements\n- TypeScript\n- React');
    expect(blocks[0]).toEqual({ type: 'heading', text: 'Requirements' });
    expect(blocks[1]).toMatchObject({ type: 'list' });
  });
});
