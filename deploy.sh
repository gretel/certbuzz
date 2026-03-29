#!/bin/bash
set -e

# Configuration
REGION="eu-central-1"
INSTANCE_TYPE="t3.micro"
KEY_NAME="azurelympics-key"
SG_NAME="azurelympics-allow-all"
INSTANCE_NAME="azurelympics-104"
UBUNTU_AMI="ami-0084a47cc718c111a"
APP_DIR="/Users/tom/src/azurelympics"
DOMAIN="test.jitter.eu"
EMAIL="admin@jitter.eu"

echo "=== Azurelympics Deployment ==="

# Check AWS CLI
aws sts get-caller-identity &>/dev/null || { echo "Run 'aws configure' first"; exit 1; }

# Find or create instance
get_instance() {
    aws ec2 describe-instances --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,stopped" \
        --region $REGION --query 'Reservations[0].Instances[0].[InstanceId,State.Name,PublicIpAddress]' --output text 2>/dev/null
}

INSTANCE_INFO=$(get_instance)
INSTANCE_ID=$(echo "$INSTANCE_INFO" | awk '{print $1}')
INSTANCE_STATE=$(echo "$INSTANCE_INFO" | awk '{print $2}')

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
    echo "Creating new instance..."
    SG_ID=$(aws ec2 describe-security-groups --group-names $SG_NAME --region $REGION --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || \
        aws ec2 create-security-group --group-name $SG_NAME --description "Azurelympics" --region $REGION --query 'GroupId' --output text)
    aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol all --cidr 0.0.0.0/0 --region $REGION 2>/dev/null || true
    [ -f ~/.ssh/${KEY_NAME}.pem ] || aws ec2 create-key-pair --key-name $KEY_NAME --region $REGION --query 'KeyMaterial' --output text > ~/.ssh/${KEY_NAME}.pem
    chmod 400 ~/.ssh/${KEY_NAME}.pem
    INSTANCE_ID=$(aws ec2 run-instances --image-id $UBUNTU_AMI --count 1 --instance-type $INSTANCE_TYPE \
        --key-name $KEY_NAME --security-group-ids $SG_ID \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$INSTANCE_NAME}]" \
        --region $REGION --query 'Instances[0].InstanceId' --output text)
    echo "Launched: $INSTANCE_ID"
    aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION
    FIRST_DEPLOY=true
elif [ "$INSTANCE_STATE" = "stopped" ]; then
    echo "Starting stopped instance..."
    aws ec2 start-instances --instance-ids $INSTANCE_ID --region $REGION >/dev/null
    aws ec2 wait instance-running --instance-ids $INSTANCE_ID --region $REGION
fi

INSTANCE_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --region $REGION \
    --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "Instance: $INSTANCE_ID @ $INSTANCE_IP"

# Wait for SSH
echo "Waiting for SSH..."
for i in {1..20}; do
    ssh -i ~/.ssh/${KEY_NAME}.pem -o StrictHostKeyChecking=no -o ConnectTimeout=5 ubuntu@$INSTANCE_IP "true" 2>/dev/null && break
    sleep 5
done

SSH="ssh -i ~/.ssh/${KEY_NAME}.pem -o StrictHostKeyChecking=no ubuntu@$INSTANCE_IP"

# First deploy: install Node.js, PM2, Nginx, Certbot
if [ "$FIRST_DEPLOY" = true ] || ! $SSH "command -v node" &>/dev/null; then
    echo "Installing Node.js, PM2, Nginx..."
    $SSH "curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs build-essential nginx certbot python3-certbot-nginx && sudo npm i -g pm2" >/dev/null
fi

# Sync files
echo "Syncing files..."
rsync -az --delete --exclude 'node_modules' --exclude '.git' --exclude 'dist' --exclude 'database.db' --exclude '*.sh' \
    -e "ssh -i ~/.ssh/${KEY_NAME}.pem -o StrictHostKeyChecking=no" "$APP_DIR/" ubuntu@$INSTANCE_IP:~/azurelympics/

# Build, configure nginx, restart
echo "Building & configuring..."
$SSH DOMAIN="$DOMAIN" EMAIL="$EMAIL" bash << 'ENDSSH'
cd ~/azurelympics
cat > .env << EOF
DOZENT_PASSWORD=Dozent128
PORT=8000
HOST=0.0.0.0
NODE_ENV=production
ALLOWED_ORIGINS=https://${DOMAIN},http://${DOMAIN}
EOF

cd server && npm i --silent && npm run build >/dev/null
cd ../client && npm i --silent && npm run build >/dev/null
cd ../server && pm2 delete azurelympics 2>/dev/null || true && pm2 start dist/server.js --name azurelympics && pm2 save >/dev/null
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu >/dev/null 2>&1 || true

# Configure Nginx (always update for WebSocket optimization)
sudo tee /etc/nginx/sites-available/azurelympics >/dev/null << NGINX
upstream app {
    server localhost:8000;
    keepalive 64;
}
server {
    listen 80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name ${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_cache_bypass \$http_upgrade;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    location / { proxy_pass http://app; }
    location /socket.io/ { proxy_pass http://app; proxy_buffering off; }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/azurelympics /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
# Get SSL cert if not exists
[ -f /etc/letsencrypt/live/${DOMAIN}/fullchain.pem ] || sudo certbot certonly --nginx -d ${DOMAIN} --non-interactive --agree-tos --email ${EMAIL} 2>/dev/null
sudo nginx -t && sudo systemctl reload nginx
ENDSSH

echo ""
echo "=== Done! ==="
echo "URL: https://$DOMAIN"
echo "SSH: ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$INSTANCE_IP"
