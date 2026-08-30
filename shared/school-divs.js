// The age groups old enough to be on a school team.
//
// One list, imported by both things that have to agree about it: the gear
// order form, which tacks the school questions onto the end for families who
// never answered them (api/gear-form.js), and the Gear Orders board, which
// chases the ones still missing (src/App.jsx).
//
// When they disagree, the board chases a family for an answer the form never
// asked them for — which is the same bug as a team missing from the dropdown,
// and just as invisible until someone is standing at a table repeating a
// question that has no field.
//
// U11 and U12 are deliberately absent: school volleyball starts in 7th grade
// here, so asking a 10-year-old's family which school team she made is a
// question with no right answer.
export const SCHOOL_DIVS = ["U13", "U14", "U15", "U16"];
