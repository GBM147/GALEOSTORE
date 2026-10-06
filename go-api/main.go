package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Category struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

type StoreResponse struct {
	Products   []map[string]any `json:"products"`
	Categories []Category       `json:"categories"`
}

var allowedCategories = map[string]struct{}{
	"camisetas": {},
	"calcas":    {},
	"camisas":   {},
	"moletons":  {},
	"bermudas":  {},
	"casacos":   {},
	"calcados":  {},
	"acessorios": {},
}

func normalize(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"á", "a", "à", "a", "ã", "a", "â", "a", "ä", "a",
		"é", "e", "è", "e", "ê", "e", "ë", "e",
		"í", "i", "ì", "i", "î", "i", "ï", "i",
		"ó", "o", "ò", "o", "õ", "o", "ô", "o", "ö", "o",
		"ú", "u", "ù", "u", "û", "u", "ü", "u",
		"ç", "c",
	)
	return replacer.Replace(value)
}

func isAllowedCategory(name string) bool {
	_, ok := allowedCategories[normalize(name)]
	return ok
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		allowedOrigin := os.Getenv("ALLOWED_ORIGIN")
		if allowedOrigin == "" {
			allowedOrigin = "https://galeo-store.onrender.com"
		}

		if origin == allowedOrigin {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Cache-Control", "no-store")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("json encode error: %v", err)
	}
}

func upstreamURL() string {
	value := strings.TrimRight(strings.TrimSpace(os.Getenv("UPSTREAM_URL")), "/")
	if value == "" {
		value = "https://galeo-store.onrender.com"
	}
	return value
}

func fetchStore(ctx context.Context) (StoreResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL()+"/api/store", nil)
	if err != nil {
		return StoreResponse{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "GALEO-Go-API/1.0")

	response, err := (&http.Client{Timeout: 8 * time.Second}).Do(request)
	if err != nil {
		return StoreResponse{}, err
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return StoreResponse{}, &upstreamStatusError{status: response.StatusCode}
	}

	var store StoreResponse
	if err := json.NewDecoder(response.Body).Decode(&store); err != nil {
		return StoreResponse{}, err
	}
	return store, nil
}

type upstreamStatusError struct {
	status int
}

func (e *upstreamStatusError) Error() string {
	return "upstream returned HTTP " + strconv.Itoa(e.status)
}

func filteredStore(store StoreResponse) StoreResponse {
	categories := make([]Category, 0, len(store.Categories))
	for _, category := range store.Categories {
		if isAllowedCategory(category.Name) {
			categories = append(categories, category)
		}
	}
	sort.SliceStable(categories, func(i, j int) bool {
		if categories[i].SortOrder == categories[j].SortOrder {
			return categories[i].ID < categories[j].ID
		}
		return categories[i].SortOrder < categories[j].SortOrder
	})

	products := make([]map[string]any, 0, len(store.Products))
	for _, product := range store.Products {
		category, _ := product["category"].(string)
		if category != "" && !isAllowedCategory(category) {
			continue
		}
		products = append(products, product)
	}

	return StoreResponse{
		Products:   products,
		Categories: categories,
	}
}

func storeHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/store" {
		http.NotFound(w, r)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
	defer cancel()

	store, err := fetchStore(ctx)
	if err != nil {
		log.Printf("store upstream error: %v", err)
		writeJSON(w, http.StatusBadGateway, map[string]any{
			"success": false,
			"error":   "Não foi possível carregar o catálogo agora.",
		})
		return
	}

	writeJSON(w, http.StatusOK, filteredStore(store))
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":   "ok",
		"service":  "galeo-api-go",
		"language": "go",
	})
}

func main() {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "10000"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/store", storeHandler)

	server := &http.Server{
		Addr:              "0.0.0.0:" + port,
		Handler:           withCORS(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       12 * time.Second,
		WriteTimeout:      12 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	log.Printf("GALEO Go API running on port %s", port)
	log.Printf("Upstream: %s", upstreamURL())

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
