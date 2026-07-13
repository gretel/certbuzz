#!/bin/bash
set -e

# Configuration (must match deploy.sh)
REGION="eu-central-1"
INSTANCE_NAME="azurelympics-104"
SG_NAME="azurelympics-allow-all"
KEY_NAME="azurelympics-key"

echo "=== Azurelympics Undeploy ==="

aws sts get-caller-identity &>/dev/null || { echo "Run 'aws configure' first"; exit 1; }

# Find instance
INSTANCE_INFO=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=$INSTANCE_NAME" "Name=instance-state-name,Values=running,stopped" \
    --region $REGION --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' --output text 2>/dev/null)
INSTANCE_ID=$(echo "$INSTANCE_INFO" | awk '{print $1}')

if [ "$INSTANCE_ID" = "None" ] || [ -z "$INSTANCE_ID" ]; then
    echo "No instance found with name '$INSTANCE_NAME'."
else
    echo "Found instance: $INSTANCE_ID"
    echo "Terminating..."
    aws ec2 terminate-instances --instance-ids $INSTANCE_ID --region $REGION >/dev/null
    aws ec2 wait instance-terminated --instance-ids $INSTANCE_ID --region $REGION
    echo "Instance terminated."
fi

# Clean up security group
SG_ID=$(aws ec2 describe-security-groups --group-names $SG_NAME --region $REGION \
    --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null) || true
if [ -n "$SG_ID" ] && [ "$SG_ID" != "None" ]; then
    echo "Deleting security group $SG_NAME..."
    # May need a short wait for instance to fully release the SG
    sleep 5
    aws ec2 delete-security-group --group-id $SG_ID --region $REGION 2>/dev/null && echo "Security group deleted." || echo "Could not delete security group (may still be in use, retry later)."
fi

# Clean up key pair
if aws ec2 describe-key-pairs --key-names $KEY_NAME --region $REGION &>/dev/null; then
    echo "Deleting key pair $KEY_NAME..."
    aws ec2 delete-key-pair --key-name $KEY_NAME --region $REGION
    echo "Key pair deleted from AWS."
    [ -f ~/.ssh/${KEY_NAME}.pem ] && rm ~/.ssh/${KEY_NAME}.pem && echo "Local key file removed."
fi

echo ""
echo "=== Undeploy complete ==="
echo "Note: DNS record for the domain must be removed manually if applicable."
