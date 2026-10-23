import { Student } from "../types/students";

// Fuzzy search scoring function
export const getFuzzyScore = (text: string, query: string): number => {
  if (!query) return 0;
  
  const textLower = text.toLowerCase();
  const queryLower = query.toLowerCase();
  
  // Exact match gets highest score
  if (textLower === queryLower) return 1000;
  
  // Starts with query gets high score
  if (textLower.startsWith(queryLower)) return 500;
  
  // Contains query gets medium score
  if (textLower.includes(queryLower)) return 250;
  
  // Fuzzy match - calculate based on matching characters in order
  let score = 0;
  let textIndex = 0;
  
  for (let i = 0; i < queryLower.length; i++) {
    const char = queryLower[i];
    const foundIndex = textLower.indexOf(char, textIndex);
    
    if (foundIndex === -1) return 0; // Character not found
    
    // Closer characters get higher scores
    const distance = foundIndex - textIndex;
    score += Math.max(0, 100 - distance * 2);
    textIndex = foundIndex + 1;
  }
  
  return score;
};

// Filter and sort students by query
export const filterAndSortStudents = (students: Student[], query?: string): Student[] => {
  if (!query || query.trim() === "") return students;
  
  const trimmedQuery = query.trim();
  
  // Calculate scores for each student
  const studentsWithScores = students.map(student => {
    const idScore = getFuzzyScore(student.id, trimmedQuery);
    const firstNameScore = getFuzzyScore(student.firstName || "", trimmedQuery);
    const middleNameScore = getFuzzyScore(student.middleName || "", trimmedQuery);
    const lastNameScore = getFuzzyScore(student.lastName || "", trimmedQuery);
    
    // Full name search
    const fullName = `${student.firstName || ""} ${student.middleName || ""} ${student.lastName || ""}`.trim();
    const fullNameScore = getFuzzyScore(fullName, trimmedQuery);
    
    // Take the highest score from any field
    const maxScore = Math.max(getFuzzyScore(student.usn ?? "", trimmedQuery), getFuzzyScore(student.lrn ?? "", trimmedQuery), idScore, firstNameScore, middleNameScore, lastNameScore, fullNameScore);
    
    return {
      student,
      score: maxScore
    };
  });
  
  // Filter out non-matches and sort by score (highest first)
  return studentsWithScores
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.student);
};
