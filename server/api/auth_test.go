package api

import "testing"

func TestIsSafeRedirect(t *testing.T) {
	tests := []struct {
		name   string
		target string
		want   bool
	}{
		// Allowed: relative paths
		{name: "root", target: "/", want: true},
		{name: "relative path", target: "/dashboard", want: true},
		{name: "relative path with query", target: "/page?foo=bar", want: true},

		// Allowed: hnreader custom scheme
		{name: "hnreader callback", target: "hnreader://auth-callback", want: true},
		{name: "hnreader other path", target: "hnreader://anything", want: true},

		// Rejected: empty
		{name: "empty string", target: "", want: false},

		// Rejected: absolute URLs to external hosts
		{name: "https external", target: "https://evil.com", want: false},
		{name: "http external", target: "http://evil.com", want: false},
		{name: "https with path", target: "https://evil.com/steal", want: false},

		// Rejected: protocol-relative URLs
		{name: "protocol-relative", target: "//evil.com", want: false},
		{name: "protocol-relative with path", target: "//evil.com/steal", want: false},

		// Rejected: other schemes
		{name: "javascript scheme", target: "javascript:alert(1)", want: false},
		{name: "data scheme", target: "data:text/html,<h1>hi</h1>", want: false},
		{name: "ftp scheme", target: "ftp://files.example.com", want: false},

		// Rejected: sneaky variations
		{name: "backslash relative", target: "\\evil.com", want: false},
		{name: "scheme with user info", target: "https://user@evil.com", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isSafeRedirect(tt.target)
			if got != tt.want {
				t.Errorf("isSafeRedirect(%q) = %v, want %v", tt.target, got, tt.want)
			}
		})
	}
}
