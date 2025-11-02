#include <iostream>
#include <cmath>

class Shape {
public:
    virtual double area() = 0;
    virtual double perimeter() = 0;
    virtual ~Shape() {}
};

class Circle : public Shape {
private:
    double radius;

public:
    Circle(double r) : radius(r) {}

    double area() override {
        return M_PI * radius * radius;
    }

    double perimeter() override {
        return 2 * M_PI * radius;
    }
};

class Rectangle : public Shape {
private:
    double width;
    double height;

public:
    Rectangle(double w, double h) : width(w), height(h) {}

    double area() override {
        return width * height;
    }

    double perimeter() override {
        return 2 * (width + height);
    }
};

void printShapeInfo(Shape* shape) {
    std::cout << "Area: " << shape->area() << std::endl;
    std::cout << "Perimeter: " << shape->perimeter() << std::endl;
}

int main() {
    Circle circle(5.0);
    Rectangle rect(4.0, 6.0);

    std::cout << "Circle:" << std::endl;
    printShapeInfo(&circle);

    std::cout << "\nRectangle:" << std::endl;
    printShapeInfo(&rect);

    return 0;
}
