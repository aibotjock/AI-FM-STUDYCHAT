import test from 'node:test';
import assert from 'node:assert/strict';
import { isActualCareRequest } from '../server/study-curriculum.js';

test('ordinary life, family and study scheduling remain available to the conversational tutor', () => {
  for (const text of [
    'I have a dog.', 'I have a guitar.', 'I have a busy week.',
    'I study with my wife.', 'My child likes music.', 'My husband helps me revise.',
    'I have a dog and want to study asthma.',
    'I have a book about asthma.', 'I have a question about diabetes.',
    'I have flashcards for hypertension.', 'My wife has a study plan for asthma.',
    'My wife helps me study how to treat asthma.',
    'I am having a hard time studying asthma.',
    'I have 10 minutes to study.', 'I have twenty minutes to review.',
    'Can I take a break?', 'Should I start studying now?',
    'What should I do to remember these study cards?',
  ]) assert.equal(isActualCareRequest(text), false, text);
});

test('personal symptoms, medical measurements and medication requests retain the early care redirect', () => {
  for (const text of [
    'I have asthma.', 'I have COPD.', 'I have lupus.',
    'I have chest pain.', 'I feel dizzy.', 'I am experiencing palpitations.',
    "I'm having trouble breathing right now.", 'I have ten minutes of palpitations.',
    'I have twenty minutes with chest pain.', 'My blood pressure is 180/110.',
    'I was diagnosed with a rare condition.', 'I have been diagnosed with asthma.',
    'My child has a cough.', 'Our son was diagnosed with depression.',
    'My wife is having chest pain.', 'My father is taking warfarin.',
    'Should I stop my medication?', 'Could I increase metformin?',
    'What should I take for this rash?', 'What medication dose for me?',
    'How should I treat my child?', 'What dose should I give my daughter?',
    'My patient has asthma.', 'B because my patient has asthma.',
  ]) assert.equal(isActualCareRequest(text), true, text);
});

test('explicit hypothetical study clauses remain eligible unless that clause identifies actual care', () => {
  for (const text of [
    'In a fictional board vignette, my patient has asthma. Study asthma.',
    'For a hypothetical case, my child has a cough.',
    'In a simulated board-style case, I have chest pain.',
    'For a practice vignette, what medication dose for me?',
  ]) assert.equal(isActualCareRequest(text), false, text);
  for (const text of [
    'My actual patient has asthma in a hypothetical board case.',
    'In a hypothetical case, my real child has a cough.',
    'Hypothetically, I have chest pain right now.',
  ]) assert.equal(isActualCareRequest(text), true, text);
});

test('separate actual-care clauses are not hidden by ordinary life or fictional study framing', () => {
  for (const text of [
    'I have a dog and I have asthma.',
    'I have ten minutes to study, but my child has a cough.',
    'In a fictional board vignette, my patient has asthma; my daughter has a fever.',
    'Study a fictional case. My wife is experiencing chest pain.',
    'For a hypothetical case, my child has a cough, but I have chest pain.',
    'I study with my wife. Should I stop my medication?',
  ]) assert.equal(isActualCareRequest(text), true, text);
});

test('nonpersonal source questions remain study requests and non-text input fails closed', () => {
  for (const text of [
    'Explain asthma for board study.',
    'What do the sources say about blood pressure?',
    'What medication dose does this hypothetical vignette establish?',
    'How should the fictional patient be treated in this practice vignette?',
  ]) assert.equal(isActualCareRequest(text), false, text);
  for (const input of [null, undefined, {}, 42]) assert.equal(isActualCareRequest(input), true);
});
