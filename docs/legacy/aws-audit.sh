#!/bin/bash

echo "=== AWS Resource Audit (All Regions) ==="
echo "Goal: Only Route53 should remain."
echo ""

aws sts get-caller-identity &>/dev/null || { echo "Run 'aws configure' first"; exit 1; }

REGIONS=$(aws ec2 describe-regions --query 'Regions[].RegionName' --output text)
FOUND=0

for REGION in $REGIONS; do
    REGION_HEADER_PRINTED=false
    print_region() {
        if [ "$REGION_HEADER_PRINTED" = false ]; then
            echo "--- $REGION ---"
            REGION_HEADER_PRINTED=true
        fi
    }

    # EC2 Instances
    ITEMS=$(aws ec2 describe-instances --region $REGION \
        --filters "Name=instance-state-name,Values=running,stopped,pending" \
        --query 'Reservations[].Instances[].[InstanceId,InstanceType,Tags[?Key==`Name`].Value|[0]]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  EC2 Instances:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # EBS Volumes (not attached to terminated instances)
    ITEMS=$(aws ec2 describe-volumes --region $REGION \
        --query 'Volumes[].[VolumeId,Size,State]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  EBS Volumes:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Elastic IPs
    ITEMS=$(aws ec2 describe-addresses --region $REGION \
        --query 'Addresses[].[PublicIp,AllocationId]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Elastic IPs:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # NAT Gateways
    ITEMS=$(aws ec2 describe-nat-gateways --region $REGION \
        --filter "Name=state,Values=available,pending" \
        --query 'NatGateways[].[NatGatewayId,State]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  NAT Gateways:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Load Balancers (ELB v2)
    ITEMS=$(aws elbv2 describe-load-balancers --region $REGION \
        --query 'LoadBalancers[].[LoadBalancerName,Type,State.Code]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Load Balancers (v2):"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Classic Load Balancers
    ITEMS=$(aws elb describe-load-balancers --region $REGION \
        --query 'LoadBalancerDescriptions[].LoadBalancerName' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Classic Load Balancers:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # RDS
    ITEMS=$(aws rds describe-db-instances --region $REGION \
        --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceClass,DBInstanceStatus]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  RDS Instances:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lambda
    ITEMS=$(aws lambda list-functions --region $REGION \
        --query 'Functions[].FunctionName' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lambda Functions:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # S3 (only check once, s3 is global)
    if [ "$REGION" = "us-east-1" ]; then
        ITEMS=$(aws s3api list-buckets --query 'Buckets[].Name' --output text 2>/dev/null)
        if [ -n "$ITEMS" ]; then
            echo "--- global ---"
            echo "  S3 Buckets:"; echo "$ITEMS" | tr '\t' '\n' | while read line; do echo "    $line"; done; FOUND=1
        fi
    fi

    # Lightsail Instances
    ITEMS=$(aws lightsail get-instances --region $REGION \
        --query 'instances[].[name,state.name,blueprintId]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Instances:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lightsail Databases
    ITEMS=$(aws lightsail get-relational-databases --region $REGION \
        --query 'relationalDatabases[].relationalDatabaseName' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Databases:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lightsail Static IPs
    ITEMS=$(aws lightsail get-static-ips --region $REGION \
        --query 'staticIps[].name' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Static IPs:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lightsail Load Balancers
    ITEMS=$(aws lightsail get-load-balancers --region $REGION \
        --query 'loadBalancers[].name' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Load Balancers:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lightsail Container Services
    ITEMS=$(aws lightsail get-container-services --region $REGION \
        --query 'containerServices[].containerServiceName' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Containers:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Lightsail Disks
    ITEMS=$(aws lightsail get-disks --region $REGION \
        --query 'disks[].name' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Lightsail Disks:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # ECS Clusters
    ITEMS=$(aws ecs list-clusters --region $REGION \
        --query 'clusterArns[]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  ECS Clusters:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Security Groups (non-default)
    ITEMS=$(aws ec2 describe-security-groups --region $REGION \
        --query 'SecurityGroups[?GroupName!=`default`].[GroupId,GroupName]' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  Security Groups (non-default):"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

    # Key Pairs
    ITEMS=$(aws ec2 describe-key-pairs --region $REGION \
        --query 'KeyPairs[].KeyName' --output text 2>/dev/null)
    if [ -n "$ITEMS" ]; then print_region; echo "  EC2 Key Pairs:"; echo "$ITEMS" | while read line; do echo "    $line"; done; FOUND=1; fi

done

# Route53 (global) - show for reference
echo ""
echo "--- Route53 (expected) ---"
aws route53 list-hosted-zones --query 'HostedZones[].[Name,Id]' --output text 2>/dev/null | while read line; do echo "  $line"; done

echo ""
if [ $FOUND -eq 0 ]; then
    echo "=== Clean! Only Route53 remains. ==="
else
    echo "=== Resources found above should be reviewed for cleanup. ==="
fi
