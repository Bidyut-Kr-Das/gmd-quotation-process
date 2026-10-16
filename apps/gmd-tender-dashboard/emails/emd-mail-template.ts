export const EMD_MAIL_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Request for Release of Bid Guarantee / Bank Guarantee</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 30px 15px;
      background-color: #f5f6f8;
      font-family: Arial, Helvetica, sans-serif;
      color: #222;
      line-height: 1.6;
    }

    .email-container {
      max-width: 700px;
      margin: 0 auto;
      background-color: #ffffff;
      border: 1px solid #dddddd;
    }

    .header {
      padding: 30px 40px 20px;
      text-align: center;
      border-bottom: 1px solid #e5e5e5;
    }

    .header h1 {
      margin: 0;
      font-size: 20px;
      color: #1f2937;
      line-height: 1.4;
    }

    .content {
      padding: 30px 40px;
    }

    .content p {
      margin: 0 0 18px;
    }

    .subject {
      margin: 20px 0;
      font-weight: bold;
    }

    .details-table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
    }

    .details-table td {
      padding: 10px;
      border: 1px solid #dddddd;
      vertical-align: top;
    }

    .details-table td:first-child {
      width: 35%;
      font-weight: bold;
      background-color: #f3f4f6;
    }

    .signature {
      margin-top: 30px;
    }

    .signature p {
      margin: 0 0 5px;
    }

    @media only screen and (max-width: 600px) {
      body {
        padding: 10px;
      }

      .content,
      .header {
        padding-left: 20px;
        padding-right: 20px;
      }

      .header h1 {
        font-size: 18px;
      }

      .details-table td {
        display: block;
        width: 100% !important;
      }

      .details-table td:first-child {
        border-bottom: 0;
      }
    }
  </style>
</head>

<body>

  <div class="email-container">

    <div class="header">
      <h1>
        REQUEST FOR RELEASE OF BID GUARANTEE / BANK GUARANTEE
      </h1>
    </div>

    <div class="content">

      <p>
        Dear Sir/Madam,
      </p>

      <p>
        With reference to the above-mentioned tender, we had submitted a
        <strong>
          Bid Guarantee / Earnest Money Deposit (EMD) in the form of Bank
          Guarantee
        </strong>,
        details of which are as follows:
      </p>

      <table class="details-table">
        <tr>
          <td>Tender No.</td>
          <td>{{tenderNumber}}</td>
        </tr>

        <tr>
          <td>Tender Description</td>
          <td>{{tenderDescription}}</td>
        </tr>

        <tr>
          <td>Bank Guarantee No.</td>
          <td>{{bgNumber}}</td>
        </tr>

        <tr>
          <td>Date of Issue</td>
          <td>{{bgIssueDate}}</td>
        </tr>

        <tr>
          <td>Issuing Bank</td>
          <td>{{bankName}}</td>
        </tr>

        <tr>
          <td>BG Amount</td>
          <td>{{bgAmount}}</td>
        </tr>

        <tr>
          <td>Validity</td>
          <td>Up to {{bgValidityDate}}</td>
        </tr>
      </table>

      <p>
        We understand that the tender process has reached its conclusion and
        that
        <strong>{{tenderOutcome}}</strong>.
      </p>

      <p>
        Since our Bid Guarantee is no longer required to remain valid for the
        purpose of the above tender, we kindly request you to arrange for the
        <strong>
          release, discharge and/or return of the original Bank Guarantee
        </strong>
        at the earliest.
      </p>

      <p>
        We further request you to issue the necessary confirmation/intimation
        to the issuing bank, wherever applicable, confirming that you have
        <strong>
          no further claim or lien against the above Bid Guarantee
        </strong>
        and that the same may be treated as cancelled/released.
      </p>

      <p>
        We shall appreciate your prompt action in this matter.
      </p>

      <p>
        Thanking you.
      </p>

      <div class="signature">

        <p>
          Yours faithfully,
        </p>

        <p style="margin-top: 25px;">
          <strong>For {{companyName}}</strong>
        </p>

        <p style="margin-top: 40px;">
          <strong>Authorized Signatory</strong>
        </p>

        <p style="margin-top: 20px;">
          <strong>Date:</strong> {{date}}
        </p>

      </div>

    </div>

  </div>

</body>
</html>

`

export interface EMD_MAIL_TYPE  {
  employerName: string;
  employerAddress: string;

  tenderNumber: string;
  tenderDescription: string;

  bgNumber: string;
  bgIssueDate: string;
  bankName: string;
  bgAmount: string;
  bgValidityDate: string;

  tenderOutcome: string;

  companyName: string;
  date: string;
}