package main

import (
	"fmt"
	"net/http"
)

type Server struct {
	port string
}

func NewServer(port string) *Server {
	return &Server{port: port}
}

func (s *Server) Start() error {
	http.HandleFunc("/", handleRoot)
	http.HandleFunc("/health", handleHealth)
	return http.ListenAndServe(":"+s.port, nil)
}

func handleRoot(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "Hello, World!")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintf(w, "OK")
}

func main() {
	server := NewServer("8080")
	fmt.Println("Starting server on :8080")
	server.Start()
}
