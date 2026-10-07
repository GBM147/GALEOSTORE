package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
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
	"camisetas":  {},
	"calcas":     {},
	"camisas":    {},
	"moletons":   {},
	"bermudas":   {},
	"casacos":    {},
	"calcados":   {},
	"acessorios": {},
}

var categoryOrder = []string{
	"Camisetas",
	"Calças",
	"Camisas",
	"Moletons",
	"Bermudas",
	"Casacos",
	"Calçados",
	"Acessórios",
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
	existing := make(map[string]Category, len(store.Categories))
	for _, category := range store.Categories {
		if isAllowedCategory(category.Name) {
			existing[normalize(category.Name)] = category
		}
	}

	categories := make([]Category, 0, len(categoryOrder))
	for index, name := range categoryOrder {
		category, ok := existing[normalize(name)]
		if !ok {
			category = Category{
				ID: 1000 + index,
			}
		}
		category.Name = name
		category.SortOrder = (index + 1) * 10
		categories = append(categories, category)
	}

	sort.SliceStable(categories, func(i, j int) bool {
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

func fetchProduct(ctx context.Context, id string) (map[string]any, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL()+"/api/store/products/"+url.PathEscape(id), nil)
	if err != nil { return nil, err }
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "GALEO-Go-API/1.0")
	response, err := (&http.Client{Timeout:8*time.Second}).Do(request)
	if err != nil { return nil, err }
	defer response.Body.Close()
	var payload map[string]any
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil { return nil, err }
	if response.StatusCode < 200 || response.StatusCode >= 300 { return payload, &upstreamStatusError{status:response.StatusCode} }
	return payload,nil
}

func productHandler(w http.ResponseWriter, r *http.Request) {
	if !strings.HasPrefix(r.URL.Path,"/api/store/products/") { http.NotFound(w,r); return }
	id:=strings.TrimPrefix(r.URL.Path,"/api/store/products/")
	if id=="" || strings.Contains(id,"/") { http.NotFound(w,r); return }
	ctx,cancel:=context.WithTimeout(r.Context(),9*time.Second)
	defer cancel()
	payload,err:=fetchProduct(ctx,id)
	if err!=nil {
		if statusErr,ok:=err.(*upstreamStatusError); ok && statusErr.status==http.StatusNotFound {
			writeJSON(w,http.StatusNotFound,payload); return
		}
		log.Printf("product upstream error: %v",err)
		writeJSON(w,http.StatusBadGateway,map[string]any{"success":false,"error":"Não foi possível carregar o produto agora."})
		return
	}
	if product,ok:=payload["product"].(map[string]any); ok {
		category,_:=product["category"].(string)
		if category!="" && !isAllowedCategory(category) { writeJSON(w,http.StatusNotFound,map[string]any{"success":false,"error":"Produto não encontrado."}); return }
	}
	writeJSON(w,http.StatusOK,payload)
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
	ctx, cancel := context.WithTimeout(r.Context(), 7*time.Second)
	defer cancel()

	store, err := fetchStore(ctx)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status":   "degraded",
			"service":  "galeo-api-go",
			"language": "go",
			"upstream": "error",
			"error":    "Catálogo de origem indisponível.",
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":      "ok",
		"service":     "galeo-api-go",
		"language":    "go",
		"upstream":    "ok",
		"products":    len(store.Products),
		"categories":  len(filteredStore(store).Categories),
	})
}

func main() {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "10000"
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/health", healthHandler)
	mux.HandleFunc("/api/store/products/", productHandler)
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

	// Smoke test no próprio processo: confirma que a API Go consegue
	// acessar o catálogo de origem antes de atender o frontend.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()

		store, err := fetchStore(ctx)
		if err != nil {
			log.Printf("SMOKE TEST /api/store: FAIL: %v", err)
			return
		}

		filtered := filteredStore(store)
		log.Printf("SMOKE TEST /api/store: OK: %d produtos, %d categorias masculinas", len(filtered.Products), len(filtered.Categories))
	}()

	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}
