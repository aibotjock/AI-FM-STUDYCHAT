// Simulation cases adapted from the uploaded Residency-Coach-AI app.
export const SCENARIOS = [
  {
    "id": "sim_angry_patient",
    "title": "Angry Patient — Delayed Referral",
    "category": "Difficult Conversations",
    "difficulty": "Developing",
    "competencies": [
      "ICS",
      "PROF",
      "PC"
    ],
    "description": "A patient is furious that their specialist referral took 6 weeks. They are demanding answers and threatening to file a complaint.",
    "systemContext": "You are playing an angry patient named Robert, 54 years old. You have been waiting 6 weeks for a cardiology referral that your family doctor promised would happen within 2 weeks. You are frustrated, feel disrespected, and are worried about your heart condition. You came in today demanding answers. Start angry but be open to de-escalation if the resident shows empathy, takes accountability, and gives you a clear action plan. Escalate if the resident gets defensive or dismissive. After the resident completes the encounter (they say 'end simulation'), switch to evaluator mode and grade them on ICS, PROF, and PC competencies.",
    "estimatedMinutes": 10
  },
  {
    "id": "sim_opioid_refill",
    "title": "Opioid Refill Request",
    "category": "Substance Use",
    "difficulty": "Advanced",
    "competencies": [
      "PC",
      "PROF",
      "ICS",
      "MK"
    ],
    "description": "A patient requests an early opioid refill, stating their medication was stolen. They appear distressed but you notice concerning patterns.",
    "systemContext": "You are playing a patient named Sarah, 38 years old. You have chronic back pain and take oxycodone 10mg TID. You are coming in today 10 days early for a refill, claiming your prescription bottle was stolen. You become defensive when questioned but are genuinely struggling with pain (and possibly also with dependence you don't want to admit). You will respond to empathy but resist direct accusations. You expect the doctor to just give you the refill. After the resident completes the encounter (they say 'end simulation'), switch to evaluator mode and provide structured ACGME-competency-based feedback.",
    "estimatedMinutes": 12
  },
  {
    "id": "sim_vaccine_hesitancy",
    "title": "Vaccine Hesitancy — COVID-19",
    "category": "Preventive Care",
    "difficulty": "Foundational",
    "competencies": [
      "ICS",
      "PC",
      "MK"
    ],
    "description": "A parent refuses vaccines for their 2-year-old based on information from social media. They are educated but mistrustful of the medical establishment.",
    "systemContext": "You are playing a parent named Jennifer, 31 years old, bringing her 2-year-old for a well-child check. You are hesitant about the MMR vaccine because of things you've read online about autism links. You are intelligent, well-spoken, and genuinely concerned — not irrational. You will respond to respectful, evidence-based conversation using motivational interviewing principles. You will shut down if you feel lectured or dismissed. After the resident says 'end simulation', switch to evaluator mode and grade using ACGME competency language.",
    "estimatedMinutes": 10
  },
  {
    "id": "sim_diabetic_resistant",
    "title": "Resistant Type 2 Diabetic Patient",
    "category": "Chronic Disease Management",
    "difficulty": "Developing",
    "competencies": [
      "PC",
      "ICS",
      "MK"
    ],
    "description": "A patient with HbA1c of 10.2% refuses insulin and has failed multiple oral medications. They are frustrated and feel like a failure.",
    "systemContext": "You are playing Marcus, 58 years old, with type 2 diabetes for 12 years. Your most recent HbA1c is 10.2% despite being on metformin and SGLT2. You absolutely refuse insulin — you watched your father go on insulin and decline rapidly, and you associate insulin with death. You feel like a failure. You are open to hearing other options but not to hearing that you need insulin. You respond well to the resident asking about your concerns rather than just telling you what to do. After the resident says 'end simulation', provide structured ACGME feedback.",
    "estimatedMinutes": 12
  },
  {
    "id": "sim_poor_health_literacy",
    "title": "Complex Discharge — Low Health Literacy",
    "category": "Care Coordination",
    "difficulty": "Developing",
    "competencies": [
      "ICS",
      "PC",
      "SBP"
    ],
    "description": "Explaining a complex new medication regimen (warfarin + heart failure meds) to a patient who reads at a 5th-grade level and lives alone.",
    "systemContext": "You are playing Dorothy, 72 years old, recently hospitalized for heart failure. You are being discharged home with warfarin, furosemide, carvedilol, and lisinopril. You completed 8th grade and reading is difficult for you. You live alone. You smile and nod a lot but often don't understand what you're being told. You will ask the resident to repeat things. You will be confused by medical jargon. Respond to clear, simple, check-back-based teaching. After the resident says 'end simulation', grade on ICS, PC, and SBP.",
    "estimatedMinutes": 10
  },
  {
    "id": "sim_goals_of_care",
    "title": "Goals of Care Discussion",
    "category": "Palliative / End of Life",
    "difficulty": "Advanced",
    "competencies": [
      "ICS",
      "PC",
      "PROF"
    ],
    "description": "A patient with advanced COPD and progressive decline wants to discuss their prognosis and end-of-life preferences.",
    "systemContext": "You are playing Harold, 78 years old, with GOLD Stage IV COPD. You have been hospitalized 3 times this year. Your spouse passed away last year. You want to talk to your doctor honestly about how much time you have and what your options are. You are not ready to give up, but you don't want to die on a ventilator either. You appreciate honesty and will shut down with medical jargon or false reassurance. You want to talk about what matters to you — your grandchildren, your garden. After the resident says 'end simulation', provide detailed ACGME-competency feedback on goals of care communication.",
    "estimatedMinutes": 15
  },
  {
    "id": "sim_difficult_attending",
    "title": "Receiving Critical Feedback from an Attending",
    "category": "Professionalism",
    "difficulty": "Foundational",
    "competencies": [
      "PROF",
      "PBLI",
      "ICS"
    ],
    "description": "Your supervising attending gives you direct, critical feedback about your patient presentation style and time management.",
    "systemContext": "You are playing Dr. Chen, a supervising attending physician. You are giving a family medicine resident direct feedback: their presentations are too long (often 7-8 minutes), they are not prioritizing the assessment and plan, and they have been late documenting notes twice this week. You are not cruel but you are direct. You expect the resident to receive feedback professionally, ask clarifying questions, and commit to a specific improvement plan. You will be frustrated if the resident becomes defensive or makes excuses. After the resident responds (and you have a natural dialogue about the feedback), switch to evaluator mode and grade on PROF and PBLI.",
    "estimatedMinutes": 8
  },
  {
    "id": "sim_family_meeting",
    "title": "Difficult Family Meeting",
    "category": "Family Dynamics",
    "difficulty": "Advanced",
    "competencies": [
      "ICS",
      "PC",
      "PROF",
      "SBP"
    ],
    "description": "Three family members disagree about care for their elderly mother with moderate dementia. One wants aggressive treatment, one wants comfort care.",
    "systemContext": "There are three family members you will role-play alternately: Tom (the oldest son, wants everything done), Linda (the daughter, who has been doing the most caregiving and wants comfort care), and Bobby (the youngest, who is rarely involved but has strong opinions). The patient is your mother, Eleanor, 84, with moderate Alzheimer's and now a hip fracture. Tom will be argumentative. Linda will be emotionally exhausted. Bobby will be a wildcard. The resident must facilitate this meeting professionally. After the resident says 'end simulation', provide feedback on ICS, PC, PROF, and SBP.",
    "estimatedMinutes": 15
  }
];

// These are authored educational exercises. They are not official milestone ratings.
export const COMPETENCIES = [
  { id: 'PC', abbr: 'PC', name: 'Patient Care', description: 'Patient-centered assessment, planning, and follow-through.' },
  { id: 'MK', abbr: 'MK', name: 'Medical Knowledge', description: 'Understanding and applying relevant clinical knowledge.' },
  { id: 'PBLI', abbr: 'PBLI', name: 'Practice-Based Learning and Improvement', description: 'Finding evidence, reflecting, and improving practice.' },
  { id: 'ICS', abbr: 'ICS', name: 'Interpersonal and Communication Skills', description: 'Clear, respectful communication with patients and teams.' },
  { id: 'PROF', abbr: 'PROF', name: 'Professionalism', description: 'Ethics, accountability, self-awareness, and seeking help.' },
  { id: 'SBP', abbr: 'SBP', name: 'Systems-Based Practice', description: 'Coordination, patient safety, and navigating systems of care.' },
];

SCENARIOS.find(s => s.id === 'sim_vaccine_hesitancy').title = 'MMR Vaccine Hesitancy';
SCENARIOS.find(s => s.id === 'sim_diabetic_resistant').title = 'Type 2 Diabetes — Treatment Concerns';
SCENARIOS.push(
  {
    id: 'reasoning_dyspnea', title: 'Dyspnea with Competing Explanations', category: 'Clinical Reasoning',
    difficulty: 'Developing', competencies: ['PC', 'MK', 'PBLI'], estimatedMinutes: 15,
    description: 'Synthesize an acute presentation in a patient with several chronic conditions. Identify what cannot wait and what evidence would change your mind.',
    systemContext: 'Fictional teaching case: A 67-year-old with COPD, heart failure, and chronic kidney disease presents with worsening dyspnea over two days. The starting observations are RR 26/min, pulse 108/min, BP 104/68, SpO2 89% on room air, mild bilateral ankle edema, and cough. Act as a clinical reasoning tutor. Present only these initial observations; do not give a diagnosis. Ask one question at a time, beginning with immediate concerns and a one-sentence problem representation. Reveal additional fictional findings only as the learner requests them, remain internally consistent, and do not imply a real patient is being managed. Require a ranked differential, discriminating evidence, a reassessment plan, and help-seeking when appropriate. When asked to end, describe reasoning strengths and gaps and one transfer exercise; do not issue formal milestone ratings.'
  },
  {
    id: 'reasoning_medications', title: 'Confusion after a Medication Change', category: 'Clinical Reasoning',
    difficulty: 'Advanced', competencies: ['PC', 'MK', 'SBP'], estimatedMinutes: 15,
    description: 'Work through uncertainty, medication reconciliation, and collateral history without anchoring on the first explanation.',
    systemContext: 'Fictional teaching case: An 80-year-old living alone has increasing confusion and two recent falls after a medication change. The list is incomplete; a daughter is available by telephone. Act as a Socratic tutor and introduce a coherent fictional medication history only when requested. Do not disclose a diagnosis initially. Start by asking about immediate safety and the information needed to form a problem representation. Ask for a differential and evidence that would support or weaken each possibility. Avoid specific prescribing recommendations or doses without a supplied verified reference. End with process feedback and one gap to revisit, not official milestone scores.'
  },
  {
    id: 'reasoning_handoff', title: 'A Complex Patient in 60 Seconds', category: 'Clinical Reasoning',
    difficulty: 'Developing', competencies: ['PC', 'ICS', 'SBP'], estimatedMinutes: 10,
    description: 'Turn a long history into a clear problem representation, prioritized active problems, and a focused handoff.',
    systemContext: 'Fictional teaching case: A 59-year-old with diabetes, chronic kidney disease, unstable housing, and a recent hospitalization returns with fatigue and difficulty obtaining medications. Act as a reasoning and handoff tutor. Present the opening information only. Ask the learner to summarize the case in one sentence, then ask for prioritized problems and what must be clarified before a plan. Encourage separation of active problems from historical diagnoses and explicit uncertainty. Finish by requesting a concise handoff that includes contingencies and ownership of follow-up. Give specific feedback without official milestone ratings.'
  },
  {
    id: 'reasoning_bias', title: 'Revisit the First Diagnosis', category: 'Clinical Reasoning',
    difficulty: 'Developing', competencies: ['MK', 'PBLI', 'PC'], estimatedMinutes: 12,
    description: 'Practice updating a differential when new information conflicts with your initial impression.',
    systemContext: 'Fictional teaching case: A 45-year-old returns after an initial visit for fatigue and nonspecific abdominal discomfort, saying symptoms have changed. Do not choose the final diagnosis in advance of the learner investigating; keep all fictional observations consistent. Begin with a problem representation. Then provide a finding that meaningfully challenges the first working diagnosis. Ask the learner to state what changed, re-rank the differential, and identify what additional evidence would resolve uncertainty. Coach the reasoning process rather than praising agreement. On ending, give a short debrief and ask for one retrieval question to save.'
  }
);

const authored = 'Authored educational exercise; suggested approach, not a clinical guideline';
export const STARTER_CARDS = [
  { front: 'What belongs in a one-sentence problem representation?', back: 'Select the relevant patient context, time course, key syndrome, and discriminating findings. Use precise descriptors and leave out details that do not change the reasoning. Then check that the summary does not assume the diagnosis.', topic: 'Problem representation', sourceTitle: authored },
  { front: 'How can you organize a differential without treating every possibility as equally likely?', back: 'In this exercise, separate likely explanations, dangerous alternatives that warrant consideration, and other plausible causes. For each leading possibility, state supporting evidence, contradictory evidence, and the next finding that would change your ranking.', topic: 'Differential diagnosis', sourceTitle: authored },
  { front: 'What question helps you challenge an early working diagnosis?', back: 'Ask what finding does not fit, what important alternative could explain it, and what evidence would make you change your mind. Deliberately update the differential when new information arrives.', topic: 'Diagnostic uncertainty', sourceTitle: authored },
  { front: 'Before discussing the full differential in a complex case, what should you consider first?', back: 'In a simulated case, first assess urgency and immediate safety concerns. Identify whether the available information calls for escalation or help before continuing a detailed reasoning exercise.', topic: 'Prioritization', sourceTitle: authored },
  { front: 'How do you distinguish an active problem from a historical diagnosis in a case presentation?', back: 'Explain what needs action or monitoring now and why. Keep historical conditions when they alter risk, interpretation, or management, and avoid simply repeating the entire problem list.', topic: 'Problem representation', sourceTitle: authored },
  { front: 'How should you choose the next test in a reasoning exercise?', back: 'State the question the test should answer and what you would do with a positive or negative result. Consider whether the result would actually change the next decision, along with limitations and patient context.', topic: 'Differential diagnosis', sourceTitle: authored },
  { front: 'What makes a follow-up plan concrete in an uncertain simulated case?', back: 'Identify who owns follow-up, what is being reassessed, when reassessment happens, what change triggers escalation, and how the patient will contact the team. The details depend on the case and applicable local guidance.', topic: 'Safety netting', sourceTitle: authored },
  { front: 'What should a focused handoff communicate beyond the diagnosis?', back: 'Practice communicating current acuity, the working assessment and uncertainty, pending tasks and results, anticipated changes, contingencies, and who is responsible for each action.', topic: 'Handoffs', sourceTitle: authored },
  { front: 'How does teach-back check understanding?', back: 'Ask the patient to describe, in their own words, what they understand or what they will do next. Frame this as checking the clarity of your explanation. Clarify gaps and ask again as needed.', topic: 'Communication', sourceTitle: 'AHRQ: Use the Teach-Back Method, Tool 5', sourceUrl: 'https://www.ahrq.gov/health-literacy/improve/precautions/tool5.html' },
  { front: 'How is teach-back different from asking whether the patient has questions?', back: 'Asking for questions invites concerns; teach-back asks the patient to explain the information or next actions in their own words so you can check understanding. Both can be useful.', topic: 'Communication', sourceTitle: 'AHRQ: Use the Teach-Back Method, Tool 5', sourceUrl: 'https://www.ahrq.gov/health-literacy/improve/precautions/tool5.html' },
  { front: 'What should you record after a reasoning error in a teaching case?', back: 'Identify the missed cue or mistaken inference, why it mattered, the better reasoning step, and one concrete question or practice case to revisit. Focus on a change you can practice rather than a global judgment of ability.', topic: 'Reflection', sourceTitle: authored },
  { front: 'How can you turn a broad lesson into a useful retrieval card?', back: 'Choose one specific decision or distinction. Write a question you can answer before revealing the back, give a concise answer with a rationale, and attach a source when the card contains factual medical claims.', topic: 'Learning skills', sourceTitle: authored },
];
