import { CognitoIdentityProviderClient, SignUpCommand, InitiateAuthCommand, ConfirmSignUpCommand, ResendConfirmationCodeCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand } from "@aws-sdk/client-cognito-identity-provider";
import { COGNITO_CONFIG } from "./cognito-config";

const cognitoClient = new CognitoIdentityProviderClient({
  region: COGNITO_CONFIG.REGION,
});

export interface SignUpParams {
  email: string;
  password: string;
  givenName?: string;
  familyName?: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

export interface ConfirmSignUpParams {
  email: string;
  code: string;
}

export interface ForgotPasswordParams {
  email: string;
}

export interface ConfirmForgotPasswordParams {
  email: string;
  code: string;
  newPassword: string;
}

export async function signUp({ email, password, givenName, familyName }: SignUpParams) {
  try {
    const command = new SignUpCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      Username: email,
      Password: password,
      UserAttributes: [
        {
          Name: "email",
          Value: email,
        },
        ...(givenName ? [{ Name: "given_name", Value: givenName }] : []),
        ...(familyName ? [{ Name: "family_name", Value: familyName }] : []),
      ],
    });

    const response = await cognitoClient.send(command);
    return {
      success: true,
      userSub: response.UserSub,
      userConfirmed: response.UserConfirmed,
    };
  } catch (error) {
    console.error("Sign up error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign up failed",
    };
  }
}

export async function confirmSignUp({ email, code }: ConfirmSignUpParams) {
  try {
    const command = new ConfirmSignUpCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
    });

    await cognitoClient.send(command);
    return {
      success: true,
    };
  } catch (error) {
    console.error("Confirm sign up error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Confirmation failed",
    };
  }
}

export async function resendConfirmationCode(email: string) {
  try {
    const command = new ResendConfirmationCodeCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      Username: email,
    });

    await cognitoClient.send(command);
    return {
      success: true,
    };
  } catch (error) {
    console.error("Resend confirmation code error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to resend code",
    };
  }
}

export async function signIn({ email, password }: SignInParams) {
  try {
    const command = new InitiateAuthCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    });

    const response = await cognitoClient.send(command);
    return {
      success: true,
      authenticationResult: response.AuthenticationResult,
    };
  } catch (error) {
    console.error("Sign in error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Sign in failed",
    };
  }
}

export async function forgotPassword({ email }: ForgotPasswordParams) {
  try {
    const command = new ForgotPasswordCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      Username: email,
    });

    await cognitoClient.send(command);
    return {
      success: true,
    };
  } catch (error) {
    console.error("Forgot password error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send reset code",
    };
  }
}

export async function confirmForgotPassword({ email, code, newPassword }: ConfirmForgotPasswordParams) {
  try {
    const command = new ConfirmForgotPasswordCommand({
      ClientId: COGNITO_CONFIG.CLIENT_ID,
      Username: email,
      ConfirmationCode: code,
      Password: newPassword,
    });

    await cognitoClient.send(command);
    return {
      success: true,
    };
  } catch (error) {
    console.error("Confirm forgot password error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reset password",
    };
  }
}