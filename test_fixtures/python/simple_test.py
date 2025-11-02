# Simple Python test file

def greet(name):
    message = f"Hello, {name}!"
    print(message)

class SimpleClass:
    def __init__(self, value):
        self.value = value

    def get_value(self):
        return self.value

instance = SimpleClass(42)
greet("World")
