package auth

import "strings"

// EmailKey puts an email address into the one form used for comparing:
// lower case, and for Gmail without dots or a "+tag", because Google treats
// john.smith@gmail.com, johnsmith@gmail.com and johnsmith+x@gmail.com as the
// same mailbox. Without this, inviting the dotted spelling would lock out the
// person who signs in with the undotted one.
func EmailKey(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	local, domain, ok := strings.Cut(email, "@")
	if !ok {
		return email
	}
	if domain == "gmail.com" || domain == "googlemail.com" {
		local, _, _ = strings.Cut(local, "+")
		local = strings.ReplaceAll(local, ".", "")
		domain = "gmail.com"
	}
	return local + "@" + domain
}

// LooksLikeEmail is a sanity check for addresses typed into a form, not a
// validator: one @, something on both sides, a dot in the domain.
func LooksLikeEmail(email string) bool {
	local, domain, ok := strings.Cut(email, "@")
	return ok && local != "" && len(email) <= 254 &&
		strings.Contains(domain, ".") && !strings.ContainsAny(email, " \t\r\n,;<>\"") &&
		!strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".")
}
