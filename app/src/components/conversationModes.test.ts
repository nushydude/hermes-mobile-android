import {describe,it,expect} from 'vitest';
import {conversationModes,currentConversationMode,modeAvailable,ModeConfirmationOwner} from './conversationModes';
import {mobileModelChoices} from './selections';

describe('conversation modes',()=>{
  it('only enables an authenticated matching Codex provider model',()=>{
    const choices=mobileModelChoices({providers:[{slug:'openai',models:['gpt-6-luna']},{slug:'openai-codex',models:['gpt-6-luna','gpt-6-astra'],unavailable_models:['gpt-6-astra']}]});
    expect(conversationModes.map(mode=>modeAvailable(mode,choices))).toEqual([true,false,false]);
    expect(modeAvailable(conversationModes[0],mobileModelChoices({providers:[{slug:'openai-codex',authenticated:false,models:['gpt-6-luna']}]}))).toBe(false);
  });
  it('requires authoritative model, provider and requested/effective effort',()=>{
    const state={model:'gpt-6-luna',provider:'openai-codex',reasoning_effort:'none',reasoning_effort_wire:'none'};
    expect(currentConversationMode(state)).toBe('Fast');
    for(const patch of [{provider:'openai'},{reasoning_effort:'low'},{reasoning_effort_wire:'low'},{reasoning_effort_wire:null},{model:'other'}])expect(currentConversationMode({...state,...patch})).toBe('Custom');
    expect(currentConversationMode(null)).toBe('Custom');
  });
  it('invalidates superseded and closed confirmations and consumes a confirmation only once',()=>{
    const owner=new ModeConfirmationOwner(),old=owner.issue(),current=owner.issue();
    expect(owner.consume(old)).toBe(false);expect(owner.consume(current)).toBe(true);expect(owner.consume(current)).toBe(false);
    const cancelled=owner.issue();owner.invalidate();expect(owner.consume(cancelled)).toBe(false);
  });
  it('excludes a preset during advanced confirmation and fences old completions after a scope reset',()=>{
    const owner=new ModeConfirmationOwner(),ticket=owner.issue();expect(owner.consume(ticket)).toBe(true);
    const advanced=owner.begin()!;expect(owner.busy()).toBe(true);expect(owner.consume(ticket)).toBe(false);
    expect(owner.begin()).toBeNull();owner.reset();const newer=owner.begin()!;
    expect(owner.finish(advanced)).toBe(false);expect(owner.busy()).toBe(true);
    expect(owner.finish(newer)).toBe(true);expect(owner.busy()).toBe(false);
  });
});
