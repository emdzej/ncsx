import { describe, expect, it } from 'vitest';
import { evalExpression } from './parser.js';
import { PredicateError } from './types.js';

describe('evalExpression', () => {
  it('evaluates literals', () => {
    expect(evalExpression('0')).toBe(false);
    expect(evalExpression('1')).toBe(true);
  });

  it('evaluates AND (+)', () => {
    expect(evalExpression('1+1')).toBe(true);
    expect(evalExpression('1+0')).toBe(false);
    expect(evalExpression('0+1')).toBe(false);
    expect(evalExpression('0+0')).toBe(false);
  });

  it('evaluates OR (,)', () => {
    expect(evalExpression('1,0')).toBe(true);
    expect(evalExpression('0,0')).toBe(false);
  });

  it('AND binds tighter than OR', () => {
    // 1+0,1  =  (1∧0) ∨ 1  =  true
    expect(evalExpression('1+0,1')).toBe(true);
    // 0,1+0  =  0 ∨ (1∧0)  =  false
    expect(evalExpression('0,1+0')).toBe(false);
  });

  it('parenthesises sub-expressions', () => {
    // (1+0),1
    expect(evalExpression('(1+0),1')).toBe(true);
    // (0,1)+0  =  (false ∨ true) ∧ false  =  false
    expect(evalExpression('(0,1)+0')).toBe(false);
  });

  it('applies ! only to a following (group)', () => {
    expect(evalExpression('!(0)')).toBe(true);
    expect(evalExpression('!(1)')).toBe(false);
    expect(evalExpression('!(1+0)')).toBe(true);          // !(false) = true
    expect(evalExpression('!(0,1)')).toBe(false);          // !(true) = false
  });

  it('allows whitespace between tokens', () => {
    expect(evalExpression('  ( 1 + 0 ) , 1  ')).toBe(true);
  });

  it('rejects trailing junk', () => {
    expect(() => evalExpression('1+1x')).toThrow(PredicateError);
  });

  it('rejects unbalanced parens', () => {
    expect(() => evalExpression('(1+0')).toThrow(PredicateError);
  });
});
