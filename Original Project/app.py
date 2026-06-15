import tkinter as tk
from tkinter import messagebox

# Global variables to store the expression and result
expression = ""
result_displayed = False

def press(num):
    """Appends the pressed number or operator to the expression."""
    global expression
    global result_displayed

    # If a result was just displayed, clear the expression before starting a new one
    if result_displayed:
        expression = ""
        result_displayed = False

    expression = expression + str(num)
    equation.set(expression)

def equalpress():
    """Evaluates the expression and displays the result."""
    global expression
    global result_displayed

    try:
        # Use eval to evaluate the expression string
        # This is generally safe here because we control the input to the expression string
        total = str(eval(expression))
        equation.set(total)
        expression = total  # Set expression to the result for chained calculations
        result_displayed = True # Mark that a result has been displayed
    except ZeroDivisionError:
        messagebox.showerror("Error", "Division by zero is not allowed.")
        expression = ""
        equation.set("")
        result_displayed = False
    except SyntaxError:
        messagebox.showerror("Error", "Invalid syntax.")
        expression = ""
        equation.set("")
        result_displayed = False
    except Exception as e:
        messagebox.showerror("Error", f"An error occurred: {e}")
        expression = ""
        equation.set("")
        result_displayed = False

def clear():
    """Clears the expression and the display."""
    global expression
    global result_displayed
    expression = ""
    equation.set("")
    result_displayed = False

# --- GUI Setup ---
if __name__ == "__main__":
    # Create the main window
    gui = tk.Tk()
    gui.title("Modern Calculator")
    gui.geometry("300x400")
    gui.configure(bg="#f0f0f0") # Light grey background

    # StringVar() is the variable class, we create an instance of this class.
    equation = tk.StringVar()

    # Create the text entry box for showing the expression and result
    expression_field = tk.Entry(gui, textvariable=equation, font=('Arial', 20), bd=10, insertwidth=4, width=14, borderwidth=4, justify='right')
    expression_field.grid(row=0, column=0, columnspan=4, padx=10, pady=10, ipady=10)
    equation.set('') # Initialize display to empty

    # Define button layout and properties
    button_list = [
        ('7', 1, 0), ('8', 1, 1), ('9', 1, 2), ('/', 1, 3),
        ('4', 2, 0), ('5', 2, 1), ('6', 2, 2), ('*', 2, 3),
        ('1', 3, 0), ('2', 3, 1), ('3', 3, 2), ('-', 3, 3),
        ('0', 4, 0), ('.', 4, 1), ('=', 4, 2), ('+', 4, 3),
    ]

    # Create and place number and operator buttons
    for (text, row, col) in button_list:
        if text == '=':
            button = tk.Button(gui, text=text, fg='white', bg='#66b3ff', # Blue-ish button
                             command=equalpress, height=2, width=5, font=('Arial', 14, 'bold'))
        else:
            button = tk.Button(gui, text=text, fg='black', bg='#e0e0e0', # Light grey buttons
                             command=lambda t=text: press(t), height=2, width=5, font=('Arial', 14))
        button.grid(row=row, column=col, padx=5, pady=5)

    # Create and place the Clear button
    clear_button = tk.Button(gui, text='C', fg='white', bg='#ff6666', # Red-ish button
                           command=clear, height=2, width=5, font=('Arial', 14, 'bold'))
    clear_button.grid(row=4, column=3, padx=5, pady=5) # Placed next to '+'

    # Start the GUI event loop
    gui.mainloop()