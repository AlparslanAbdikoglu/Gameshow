import React, { useState } from 'react';
import styles from './KimbillionaireControlPanel.module.css';

interface Question {
  text: string;
  answers: string[];
  correct: number;
  number: number;
}

interface QuestionEditorProps {
  questions: Question[];
  onUpdateQuestion: (index: number, question: Question) => void;
  onSave: () => void;
  onCancel: () => void;
  isVisible: boolean;
}

/**
 * Dedicated Question Editor component for editing game questions
 * Allows host to edit question text, answers, and correct answer
 */
const QuestionEditor: React.FC<QuestionEditorProps> = React.memo(({
  questions,
  onUpdateQuestion,
  onSave,
  onCancel,
  isVisible
}) => {
  const [selectedQuestionIndex, setSelectedQuestionIndex] = useState(0);

  if (!isVisible || !questions.length) return null;

  const selectedQuestion = questions[selectedQuestionIndex];

  const updateQuestionText = (text: string) => {
    onUpdateQuestion(selectedQuestionIndex, {
      ...selectedQuestion,
      text
    });
  };

  const updateAnswer = (answerIndex: number, answerText: string) => {
    const newAnswers = [...selectedQuestion.answers];
    newAnswers[answerIndex] = answerText;
    onUpdateQuestion(selectedQuestionIndex, {
      ...selectedQuestion,
      answers: newAnswers
    });
  };

  const updateCorrectAnswer = (correctIndex: number) => {
    onUpdateQuestion(selectedQuestionIndex, {
      ...selectedQuestion,
      correct: correctIndex
    });
  };

  return (
    <div className={styles.questionEditor}>
      <h3 style={{color: '#FFD700', marginBottom: '20px'}}>Edit Questions:</h3>
      
      {/* Question Selector */}
      <div style={{marginBottom: '20px'}}>
        <label style={{color: '#FFD700', display: 'block', marginBottom: '8px'}}>
          Select Question to Edit:
        </label>
        <select
          value={selectedQuestionIndex}
          onChange={(e) => setSelectedQuestionIndex(parseInt(e.target.value))}
          style={{
            padding: '8px 12px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            background: '#333',
            color: 'white',
            width: '100%',
            marginBottom: '15px'
          }}
        >
          {questions.map((q, index) => (
            <option key={index} value={index}>
              Q{q.number}: {q.text.substring(0, 50)}...
            </option>
          ))}
        </select>
      </div>

      {/* Question Text Editor */}
      <div style={{marginBottom: '20px'}}>
        <label style={{color: '#FFD700', display: 'block', marginBottom: '8px'}}>
          Question Text:
        </label>
        <textarea
          value={selectedQuestion.text}
          onChange={(e) => updateQuestionText(e.target.value)}
          style={{
            padding: '12px',
            fontSize: '14px',
            borderRadius: '4px',
            border: '1px solid rgba(255, 215, 0, 0.3)',
            background: '#333',
            color: 'white',
            width: '100%',
            height: '80px',
            resize: 'vertical'
          }}
          placeholder="Enter question text..."
        />
      </div>

      {/* Answers Editor */}
      <div style={{marginBottom: '20px'}}>
        <label style={{color: '#FFD700', display: 'block', marginBottom: '8px'}}>
          Answer Options:
        </label>
        {selectedQuestion.answers.map((answer, answerIndex) => (
          <div key={answerIndex} style={{display: 'flex', alignItems: 'center', marginBottom: '10px'}}>
            <input
              type="radio"
              name="correctAnswer"
              checked={selectedQuestion.correct === answerIndex}
              onChange={() => updateCorrectAnswer(answerIndex)}
              style={{marginRight: '8px'}}
            />
            <span style={{color: '#FFD700', marginRight: '8px', minWidth: '20px'}}>
              {String.fromCharCode(65 + answerIndex)}:
            </span>
            <input
              type="text"
              value={answer}
              onChange={(e) => updateAnswer(answerIndex, e.target.value)}
              style={{
                padding: '8px 12px',
                fontSize: '14px',
                borderRadius: '4px',
                border: selectedQuestion.correct === answerIndex 
                  ? '2px solid #4CAF50' 
                  : '1px solid rgba(255, 215, 0, 0.3)',
                background: selectedQuestion.correct === answerIndex 
                  ? 'rgba(76, 175, 80, 0.1)' 
                  : '#333',
                color: 'white',
                flex: 1
              }}
              placeholder={`Answer ${String.fromCharCode(65 + answerIndex)}`}
            />
          </div>
        ))}
        <p style={{color: '#999', fontSize: '12px', marginTop: '10px'}}>
          ✓ Click the radio button to mark the correct answer
        </p>
      </div>

      {/* Save/Cancel Buttons */}
      <div className={styles.buttonGrid} style={{marginTop: '20px'}}>
        <button className={styles.primaryBtn} onClick={onSave}>
          Save Questions
        </button>
        <button className={styles.secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
});

QuestionEditor.displayName = 'QuestionEditor';

export default QuestionEditor;