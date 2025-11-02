using System;
using System.Collections.Generic;

namespace Calculator
{
    public class Calculator
    {
        private Dictionary<string, double> memory;

        public Calculator()
        {
            memory = new Dictionary<string, double>();
        }

        public double Add(double a, double b)
        {
            return a + b;
        }

        public double Subtract(double a, double b)
        {
            return a - b;
        }

        public void Store(string key, double value)
        {
            memory[key] = value;
        }

        public double Recall(string key)
        {
            return memory.ContainsKey(key) ? memory[key] : 0.0;
        }
    }

    class Program
    {
        static void Main(string[] args)
        {
            var calc = new Calculator();
            double result = calc.Add(5, 3);
            Console.WriteLine($"5 + 3 = {result}");

            calc.Store("last", result);
            Console.WriteLine($"Stored: {calc.Recall("last")}");
        }
    }
}
