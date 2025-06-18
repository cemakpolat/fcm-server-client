#!/bin/bash

# FCM Server CLI Tool
# Usage: ./fcm.sh <command> [options]

set -e

# Configuration
DEFAULT_SERVER_URL="http://localhost:5001"
CONFIG_FILE="$HOME/.fcm_cli_config"
VERBOSE=false

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Load configuration
load_config() {
    if [[ -f "$CONFIG_FILE" ]]; then
        source "$CONFIG_FILE"
    fi
    SERVER_URL=${SERVER_URL:-$DEFAULT_SERVER_URL}
}

# Save configuration
save_config() {
    cat > "$CONFIG_FILE" << EOF
# FCM CLI Configuration
SERVER_URL="$SERVER_URL"
EOF
    echo -e "${GREEN}✅ Configuration saved to $CONFIG_FILE${NC}"
}

# Helper functions
print_usage() {
    cat << EOF
== FCM Server CLI Tool ==

Usage:
  ./fcm.sh <command> [options]

Commands:
  send           Send push notification
  register       Register FCM token
  stats          Get server statistics
  tokens         Get token information
  health         Check server health
  config         Configure server URL
  help           Show this help message

Options:
  -v, --verbose   Enable verbose output
  -u, --url URL   Server URL (overrides config)
  -h, --help      Show help for specific command

Examples:
  ./fcm.sh send --title "Hello" --body "World!"
  ./fcm.sh send --file message.json
  ./fcm.sh register --token "your-fcm-token"
  ./fcm.sh stats
  ./fcm.sh config --url "http://192.168.1.100:5001"

Configuration:
  Config file: $CONFIG_FILE
  Current server: ${SERVER_URL:-$DEFAULT_SERVER_URL}
EOF
}

print_error() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_verbose() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${PURPLE}[DEBUG] $1${NC}" >&2
    fi
}

# HTTP request helper
make_request() {
    local method="$1"
    local endpoint="$2"
    local data="$3"
    local content_type="${4:-application/json}"
    
    local url="${SERVER_URL}${endpoint}"
    local curl_args=("-s" "-w" "%{http_code}" "-X" "$method")
    
    if [[ "$VERBOSE" == true ]]; then
        curl_args+=("-v")
    fi
    
    if [[ -n "$data" ]]; then
        curl_args+=("-H" "Content-Type: $content_type" "-d" "$data")
    fi
    
    log_verbose "Making $method request to $url"
    log_verbose "Data: $data"
    
    local response
    response=$(curl "${curl_args[@]}" "$url" 2>/dev/null)
    
    local http_code="${response: -3}"
    local body="${response%???}"
    
    log_verbose "HTTP Status: $http_code"
    log_verbose "Response: $body"
    
    if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
        echo "$body"
        return 0
    else
        print_error "HTTP $http_code: $body"
        return 1
    fi
}

# Command implementations
cmd_health() {
    print_info "Checking server health..."
    
    if response=$(make_request "GET" "/"); then
        echo "$response" | jq -r '
            "Status: " + .status,
            "Version: " + .version,
            "Timestamp: " + .timestamp,
            "Registered Tokens: " + (.registered_tokens | tostring),
            "Active Tokens: " + (.active_tokens | tostring)
        ' 2>/dev/null || echo "$response"
        print_success "Server is healthy"
    else
        print_error "Server is not responding"
        return 1
    fi
}

cmd_stats() {
    print_info "Fetching server statistics..."
    
    if response=$(make_request "GET" "/stats"); then
        echo "$response" | jq -r '
            if .success then
                .stats | to_entries[] | "\(.key | gsub("_"; " ") | ascii_upcase): \(.value)"
            else
                "Error: " + .error
            end
        ' 2>/dev/null || echo "$response"
    else
        return 1
    fi
}

cmd_tokens() {
    local show_details=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --details|-d)
                show_details=true
                shift
                ;;
            --help|-h)
                cat << EOF
${YELLOW}Usage:${NC} ./fcm.sh tokens [options]

${YELLOW}Options:${NC}
  -d, --details   Show detailed token information
  -h, --help      Show this help

${YELLOW}Description:${NC}
  Get information about registered FCM tokens
EOF
                return 0
                ;;
            *)
                print_error "Unknown option: $1"
                return 1
                ;;
        esac
    done
    
    print_info "Fetching token information..."
    
    if response=$(make_request "GET" "/tokens"); then
        if [[ "$show_details" == true ]]; then
            echo "$response" | jq '.' 2>/dev/null || echo "$response"
        else
            echo "$response" | jq -r '
                if .success then
                    "Statistics:",
                    (.stats | to_entries[] | "  \(.key | gsub("_"; " ") | ascii_upcase): \(.value)"),
                    "",
                    "Token Details:",
                    (.tokens[] | "  ID: \(.id) | Active: \(.is_active) | Success: \(.successful_sends) | Failed: \(.failed_sends)")
                else
                    "Error: " + .error
                end
            ' 2>/dev/null || echo "$response"
        fi
    else
        return 1
    fi
}

cmd_register() {
    local token=""
    local file=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --token|-t)
                token="$2"
                shift 2
                ;;
            --file|-f)
                file="$2"
                shift 2
                ;;
            --help|-h)
                cat << EOF
${YELLOW}Usage:${NC} ./fcm.sh register [options]

${YELLOW}Options:${NC}
  -t, --token TOKEN   FCM token to register
  -f, --file FILE     JSON file containing token
  -h, --help          Show this help

${YELLOW}File Format:${NC}
  {
    "token": "your-fcm-token-here"
  }

${YELLOW}Examples:${NC}
  ./fcm.sh register --token "eXaMpLe_ToKeN"
  ./fcm.sh register --file token.json
EOF
                return 0
                ;;
            *)
                print_error "Unknown option: $1"
                return 1
                ;;
        esac
    done
    
    local data=""
    
    if [[ -n "$file" ]]; then
        if [[ ! -f "$file" ]]; then
            print_error "File not found: $file"
            return 1
        fi
        data=$(cat "$file")
        log_verbose "Reading token from file: $file"
    elif [[ -n "$token" ]]; then
        data=$(jq -n --arg token "$token" '{token: $token}')
        log_verbose "Using provided token"
    else
        print_error "Either --token or --file must be specified"
        return 1
    fi
    
    print_info "Registering FCM token..."
    
    if response=$(make_request "POST" "/register" "$data"); then
        echo "$response" | jq -r '
            if .success then
                "✅ " + .message,
                "Total tokens: " + (.total_tokens | tostring)
            else
                "❌ " + .error
            end
        ' 2>/dev/null || echo "$response"
    else
        return 1
    fi
}

cmd_send() {
    local title=""
    local body=""
    local file=""
    local data=""
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --title)
                title="$2"
                shift 2
                ;;
            --body)
                body="$2"
                shift 2
                ;;
            --file|-f)
                file="$2"
                shift 2
                ;;
            --data)
                data="$2"
                shift 2
                ;;
            --help|-h)
                cat << EOF
${YELLOW}Usage:${NC} ./fcm.sh send [options]

${YELLOW}Options:${NC}
  --title TITLE       Notification title
  --body BODY         Notification body
  -f, --file FILE     JSON file containing message
  --data DATA         Additional data as JSON string
  -h, --help          Show this help

${YELLOW}File Format:${NC}
  {
    "title": "Your Title",
    "body": "Your message body",
    "data": {
      "custom_field": "value"
    }
  }

${YELLOW}Examples:${NC}
  ./fcm.sh send --title "Hello" --body "World!"
  ./fcm.sh send --file message.json
  ./fcm.sh send --title "Alert" --body "Check this out" --data '{"url":"https://example.com"}'
EOF
                return 0
                ;;
            *)
                print_error "Unknown option: $1"
                return 1
                ;;
        esac
    done
    
    local payload=""
    
    if [[ -n "$file" ]]; then
        if [[ ! -f "$file" ]]; then
            print_error "File not found: $file"
            return 1
        fi
        payload=$(cat "$file")
        log_verbose "Reading message from file: $file"
    else
        # Build JSON payload
        local json_parts=()
        
        if [[ -n "$title" ]]; then
            json_parts+=("\"title\": $(echo "$title" | jq -R .)")
        fi
        
        if [[ -n "$body" ]]; then
            json_parts+=("\"body\": $(echo "$body" | jq -R .)")
        fi
        
        if [[ -n "$data" ]]; then
            json_parts+=("\"data\": $data")
        fi
        
        if [[ ${#json_parts[@]} -eq 0 ]]; then
            print_error "Either --title/--body or --file must be specified"
            return 1
        fi
        
        payload="{$(IFS=','; echo "${json_parts[*]}")}"
        log_verbose "Built payload: $payload"
    fi
    
    print_info "Sending push notification..."
    
    if response=$(make_request "POST" "/send" "$payload"); then
        echo "$response" | jq -r '
            if .success then
                "✅ " + .message,
                "Sent: " + (.sent | tostring),
                "Failed: " + (.failed | tostring),
                (if .failed > 0 then
                    "",
                    "Failed tokens:",
                    (.details.failures[] | "  • " + (.error // "Unknown error") + " (" + (.error_code // "N/A") + ")")
                else empty end)
            else
                "❌ " + .error
            end
        ' 2>/dev/null || echo "$response"
    else
        return 1
    fi
}

cmd_config() {
    local new_url=""
    local show_current=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --url|-u)
                new_url="$2"
                shift 2
                ;;
            --show|-s)
                show_current=true
                shift
                ;;
            --help|-h)
                cat << EOF
${YELLOW}Usage:${NC} ./fcm.sh config [options]

${YELLOW}Options:${NC}
  -u, --url URL       Set server URL
  -s, --show          Show current configuration
  -h, --help          Show this help

${YELLOW}Examples:${NC}
  ./fcm.sh config --url "http://192.168.1.100:5001"
  ./fcm.sh config --show
EOF
                return 0
                ;;
            *)
                print_error "Unknown option: $1"
                return 1
                ;;
        esac
    done
    
    if [[ "$show_current" == true ]]; then
        print_info "Current configuration:"
        echo "  Server URL: ${SERVER_URL:-$DEFAULT_SERVER_URL}"
        echo "  Config file: $CONFIG_FILE"
        return 0
    fi
    
    if [[ -n "$new_url" ]]; then
        SERVER_URL="$new_url"
        save_config
        print_success "Server URL updated to: $SERVER_URL"
    else
        print_error "Either --url or --show must be specified"
        return 1
    fi
}

# Main script
main() {
    # Parse global options
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -u|--url)
                SERVER_URL="$2"
                shift 2
                ;;
            -h|--help)
                print_usage
                return 0
                ;;
            -*)
                print_error "Unknown global option: $1"
                print_usage
                return 1
                ;;
            *)
                break
                ;;
        esac
    done
    
    # Load configuration
    load_config
    
    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        print_warning "jq is not installed. JSON output will be raw."
    fi
    
    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        print_error "curl is required but not installed"
        return 1
    fi
    
    # Parse command
    local command="$1"
    shift || true
    
    case "$command" in
        send)
            cmd_send "$@"
            ;;
        register)
            cmd_register "$@"
            ;;
        stats)
            cmd_stats "$@"
            ;;
        tokens)
            cmd_tokens "$@"
            ;;
        health)
            cmd_health "$@"
            ;;
        config)
            cmd_config "$@"
            ;;
        help|--help|-h|"")
            print_usage
            return 0
            ;;
        *)
            print_error "Unknown command: $command"
            print_usage
            return 1
            ;;
    esac
}

# Check if script is being sourced or executed
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi