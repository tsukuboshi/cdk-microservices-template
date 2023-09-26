import { RemovalPolicy, ScopedAws, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { DockerImageAsset, Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as ecrdeploy from "cdk-ecr-deployment";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export class CdkMicroservicesTemplateStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // Get AWS Account ID and Region
    const { accountId, region } = new ScopedAws(this);

    // Set Resource Name
    const resourceName = "test";

    // Create ECR Repository
    const ecrRepository = new ecr.Repository(this, "EcrRepo", {
      repositoryName: `${resourceName}-ecr-repo`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteImages: true,
    });

    // Create Docker Image Asset
    const dockerImageAsset = new DockerImageAsset(this, "DockerImageAsset", {
      directory: path.join(__dirname, "..", "app"),
      platform: Platform.LINUX_AMD64,
    });

    // Deploy Docker Image to ECR Repository
    new ecrdeploy.ECRDeployment(this, "DeployDockerImage", {
      src: new ecrdeploy.DockerImageName(dockerImageAsset.imageUri),
      dest: new ecrdeploy.DockerImageName(
        `${accountId}.dkr.ecr.${region}.amazonaws.com/${ecrRepository.repositoryName}:latest`
      ),
    });

    // Create VPC and Subnet
    const vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: `${resourceName}-vpc`,
      maxAzs: 2,
      ipAddresses: ec2.IpAddresses.cidr("10.0.0.0/20"),
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: `${resourceName}-public`,
          subnetType: ec2.SubnetType.PUBLIC,
        },
      ],
    });

    // Create ECS Cluster
    const cluster = new ecs.Cluster(this, "EcsCluster", {
      clusterName: `${resourceName}-cluster`,
      vpc: vpc,
    });

    // Create CloudWatch Log Group
    const logGroup = new logs.LogGroup(this, "LogGroup", {
      logGroupName: `/aws/ecs/${resourceName}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create ALB and ECS Fargate Service
    const service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "FargateService",
      {
        loadBalancerName: `${resourceName}-lb`,
        publicLoadBalancer: true,
        cluster: cluster,
        serviceName: `${resourceName}-service`,
        cpu: 256,
        desiredCount: 2,
        memoryLimitMiB: 512,
        assignPublicIp: true,
        taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        taskImageOptions: {
          family: `${resourceName}-taskdef`,
          containerName: `${resourceName}-container`,
          image: ecs.ContainerImage.fromEcrRepository(ecrRepository, "latest"),
          logDriver: new ecs.AwsLogDriver({
            streamPrefix: `container`,
            logGroup: logGroup,
          }),
        },
      }
    );
  }
}
