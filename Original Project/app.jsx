import React, { useState } from 'react';
import './App.css'; // Assuming you'll have a CSS file for styling

function App() {
  const [currentInput, setCurrentInput] = useState('');
  const [previousInput, setPreviousInput] = useState('');
  const [operator, setOperator] = useState(null);
  const [result, setResult] = useState('');

  const handleNumberClick = (num) => {
    setCurrentInput(currentInput + num);
  };

  const handleOperatorClick = (op) => {
    setOperator(op);
    setPreviousInput(currentInput);
    setCurrentInput('');
  };

  const handleEqualsClick = () => {
    if (operator && previousInput && currentInput) {
      let res;
      switch (operator) {
        case '+':
          res = parseFloat(previousInput) + parseFloat(currentInput);
          break;
        case '-':
          res = parseFloat(previousInput) - parseFloat(currentInput);
          break;
        case '*':
          res = parseFloat(previousInput) * parseFloat(currentInput);
          break;
        case '/':
          res = parseFloat(previousInput) / parseFloat(currentInput);
          break;
        default:
          break;
      }
      setResult(res.toString());
      setPreviousInput('');
      setCurrentInput(res.toString());
      setOperator(null);
    }
  };

  const handleClearClick = () => {
    setCurrentInput('');
    setPreviousInput('');
    setOperator(null);
    setResult('');
  };

  return (
    <div className="calculator">
      <div className="display">
        {result ? result : currentInput || '0'}
      </div>
      <div className="buttons">
        <button onClick={() => handleNumberClick('7')}>7</button>
        <button onClick={() => handleNumberClick('8')}>8</button>
        <button onClick={() => handleNumberClick('9')}>9</button>
        <button onClick={() => handleOperatorClick('/')}>/</button>

        <button onClick={() => handleNumberClick('4')}>4</button>
        <button onClick={() => handleNumberClick('5')}>5</button>
        <button onClick={() => handleNumberClick('6')}>6</button>
        <button onClick={() => handleOperatorClick('*')}>*</button>

        <button onClick={() => handleNumberClick('1')}>1</button>
        <button onClick={() => handleNumberClick('2')}>2</button>
        <button onClick={() => handleNumberClick('3')}>3</button>
        <button onClick={() => handleOperatorClick('-')}>-</button>

        <button onClick={() => handleNumberClick('0')}>0</button>
        <button onClick={() => handleNumberClick('.')}>.</button>
        <button onClick={handleEqualsClick}>=</button>
        <button onClick={() => handleOperatorClick('+')}>+</button>

        <button onClick={handleClearClick} className="clear-button">Clear</button>
      </div>
    </div>
  );
}

export default App;