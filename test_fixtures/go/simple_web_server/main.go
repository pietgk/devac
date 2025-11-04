package main

import (
	"flag"
	"log"
	"net/http"
	"time"

	"example.com/simple_web_server/handlers"
)

func init() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
}

func main() {
	port := flag.String("port", "8080", "Server port")
	flag.Parse()

	http.HandleFunc("/", handlers.HandleRoot)
	http.HandleFunc("/health", handlers.HandleHealth)

	server := &http.Server{
		Addr:         ":" + *port,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	log.Printf("Starting server on port %s", *port)
	log.Fatal(server.ListenAndServe())
}
