/* Learn > Levels > Lessons: one list per level. Empty for now (Learn shows "Lessons are coming soon").
   To add a lesson, add an entry to its level's list; no other change is needed:
     { name: 'Fractions', blurb: 'What a fraction is, with pictures', lab: 'fractions' }   (opens that lab)
     { name: 'Photosynthesis', blurb: 'How plants make food', ask: 'Teach me photosynthesis' } (Cassie teaches it)
   An entry with neither lab nor ask asks Cassie to teach its name.
   Levels: pre (Nursery and Kindergarten), elem (Elementary), jhs (Junior High), shs (Senior High),
   college (College and board exams). */
export const LEVEL_LESSONS = {
  pre: [],
  elem: [],
  jhs: [],
  shs: [],
  college: [],
};
